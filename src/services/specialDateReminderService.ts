import { pool } from "./dbClient";
import { logger } from "../utils/logger";
import { queueNotification } from "./notificationService";
import { APP_NAME } from "../config";

/**
 * Sends birthday and anniversary greetings to members whose special dates
 * match today's month+day (IST). Runs daily via cron.
 *
 * Uses month+day matching (ignoring year) so "April 5" matches every year.
 */
export async function processSpecialDateReminders(): Promise<{
  sent: number;
  skipped: number;
  matched: number;
  details?: { id: string; person_name: string; occasion_type: string; status: string }[];
}> {
  // Use IST (UTC+5:30) since all users are in India
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const month = nowIST.getUTCMonth() + 1; // 1-12
  const day = nowIST.getUTCDate();
  let sent = 0;
  let skipped = 0;
  const details: { id: string; person_name: string; occasion_type: string; status: string }[] = [];

  logger.info({ month, day, istDate: nowIST.toISOString() }, "processSpecialDateReminders: checking dates");

  try {
    const { rows: todayMatches } = await pool.query(
      `SELECT sd.id, sd.member_id, sd.occasion_type, sd.occasion_date,
              sd.person_name, sd.spouse_name,
              m.user_id, m.full_name, m.church_id
       FROM member_special_dates sd
       JOIN members m ON m.id = sd.member_id
       WHERE m.deleted_at IS NULL
         AND EXTRACT(MONTH FROM sd.occasion_date) = $1
         AND EXTRACT(DAY FROM sd.occasion_date) = $2
       LIMIT 1000`,
      [month, day],
    );

    logger.info({ matched: todayMatches.length, month, day }, "processSpecialDateReminders: matches found");

    if (!todayMatches.length) return { sent: 0, skipped: 0, matched: 0, details };

    for (const sd of todayMatches) {
      if (!sd.user_id || !sd.church_id) {
        skipped++;
        details.push({ id: sd.id, person_name: sd.person_name, occasion_type: sd.occasion_type, status: "skipped_no_user" });
        continue;
      }

      const isBirthday = sd.occasion_type === "birthday";
      const subject = isBirthday
        ? `Happy Birthday, ${sd.person_name}! 🎂`
        : `Happy Anniversary, ${sd.person_name}${sd.spouse_name ? ` & ${sd.spouse_name}` : ""}! 💐`;
      const body = isBirthday
        ? `Wishing you a blessed birthday! May God's grace be with you always. - ${APP_NAME}`
        : `Wishing you a blessed anniversary${sd.spouse_name ? ` with ${sd.spouse_name}` : ""}! - ${APP_NAME}`;

      try {
        await queueNotification({
          church_id: sd.church_id,
          recipient_user_id: sd.user_id,
          channel: "push",
          notification_type: isBirthday ? "birthday_greeting" : "anniversary_greeting",
          subject,
          body,
          metadata: { url: "/dashboard" },
        });
        sent++;
        details.push({ id: sd.id, person_name: sd.person_name, occasion_type: sd.occasion_type, status: "sent" });
      } catch (err) {
        logger.warn({ err, specialDateId: sd.id }, "Failed to send special date greeting");
        skipped++;
        details.push({ id: sd.id, person_name: sd.person_name, occasion_type: sd.occasion_type, status: "failed" });
      }
    }
  } catch (err) {
    logger.error({ err }, "processSpecialDateReminders failed");
  }

  return { sent, skipped, matched: sent + skipped, details };
}

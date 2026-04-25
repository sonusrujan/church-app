import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usePageMeta } from "../hooks/usePageMeta";

export default function PrivacyPolicyPage() {
  usePageMeta({
    title: "Privacy Policy – Shalom Church App",
    description: "Read the Shalom Church App privacy policy. Learn how we collect, use, and protect your personal data under the DPDP Act 2023.",
    canonical: "https://shalomapp.in/privacy",
  });
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: "1.5rem", color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>
        <ArrowLeft size={16} /> Back to Home
      </Link>

      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>Privacy Policy</h1>
      <p style={{ color: "var(--on-surface-variant)", marginBottom: "2rem" }}>Last updated: April 15, 2026</p>

      <section className="prose" style={{ lineHeight: 1.7 }}>
        <h2>1. Introduction</h2>
        <p>
          Shalom Church App ("we", "our", or "the App") is a church management and member engagement
          platform. This Privacy Policy explains how we collect, use, and protect your personal information
          when you use our application.
        </p>

        <h2>2. Information We Collect</h2>
        <ul>
          <li><strong>Phone Number:</strong> Used for authentication via OTP (One-Time Password) verification.</li>
          <li><strong>Name &amp; Profile Information:</strong> Your name, gender, and date of birth as provided during registration.</li>
          <li><strong>Church Membership Data:</strong> Church affiliation, membership status, family relationships, and roles within your church.</li>
          <li><strong>Payment Information:</strong> Transaction records for donations and subscriptions processed through Razorpay. We do not store credit/debit card numbers directly.</li>
          <li><strong>Device Information:</strong> Push notification tokens for sending church updates and reminders.</li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <ul>
          <li>To authenticate your identity and provide access to the App.</li>
          <li>To manage church membership, attendance, and family records.</li>
          <li>To process donations and subscriptions securely through our payment partner (Razorpay).</li>
          <li>To send push notifications about church events, prayer requests, and updates.</li>
          <li>To generate aggregated, non-personal insights for church administrators.</li>
        </ul>

        <h2>4. Data Storage &amp; Security</h2>
        <p>
          Your data is stored securely on Amazon Web Services (AWS) infrastructure in the Asia Pacific
          (Mumbai) region. We use encryption in transit (HTTPS/TLS) for all communications. Authentication
          tokens are stored locally on your device and transmitted via secure, HTTP-only cookies.
        </p>

        <h2>5. Data Sharing</h2>
        <p>We do not sell, trade, or rent your personal information. Your data may be shared with:</p>
        <ul>
          <li><strong>Church Administrators:</strong> Admins and pastors of your registered church can view member information relevant to church management.</li>
          <li><strong>Payment Processor:</strong> Razorpay processes donation and subscription payments in compliance with PCI-DSS standards.</li>
          <li><strong>SMS Provider:</strong> Twilio delivers OTP messages for authentication purposes only.</li>
        </ul>

        <h2>6. Push Notifications</h2>
        <p>
          You may opt in to receive push notifications about church events, prayer requests, and
          announcements. You can disable notifications at any time through your device settings or the
          App's settings page.
        </p>

        <h2>7. Your Rights</h2>
        <p>Under the Indian Digital Personal Data Protection (DPDP) Act, 2023 and applicable laws, you have the right to:</p>
        <ul>
          <li>Access and review information we hold about you by visiting your Profile page.</li>
          <li>Update or correct your personal information at any time.</li>
          <li>Request deletion of your account through the "Delete My Account" option in Settings. Your church admin will process the request.</li>
          <li>Opt out of push notifications via device or App settings.</li>
          <li>Withdraw consent for data processing by contacting the Grievance Officer below.</li>
        </ul>

        <h2>8. Legal Basis for Processing (DPDP Act, 2023)</h2>
        <p>
          Shalom Church App acts as a Data Fiduciary under the Digital Personal Data Protection Act, 2023 (India).
          We process your personal data based on your explicit consent provided during registration and use of the App.
          You may withdraw consent at any time by requesting account deletion, which will result in cessation of data processing.
        </p>

        <h2>9. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active or as needed to provide services.
          Payment records are retained for a minimum of 8 years as required by applicable Indian financial regulations.
          Upon account deletion, your personal data is removed within 30 days, except where retention is required by law.
        </p>

        <h2>10. Children's Privacy</h2>
        <p>
          The App is intended for general audiences. Family members under 18 are managed through their
          family head's account and do not have independent accounts.
        </p>

        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Changes will be posted in the App, and
          the "Last updated" date will be revised accordingly. Significant changes will be communicated via push notification.
        </p>

        <h2>12. Grievance Officer</h2>
        <p>
          In accordance with the Information Technology Act, 2000 and the DPDP Act, 2023, the details of the Grievance Officer are as follows:
        </p>
        <ul>
          <li><strong>Name:</strong> Shalom App Support Team</li>
          <li><strong>Email:</strong> grievance@shalomapp.in</li>
          <li><strong>Response Time:</strong> We will acknowledge your grievance within 48 hours and resolve it within 30 days.</li>
        </ul>

        <h2>13. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy, please reach out to your church administrator
          or contact us at <a href="mailto:sonusrujan76@gmail.comapp.in" style={{ color: "var(--primary)" }}>sonusrujan76@gmail.comapp.in</a>.
        </p>
      </section>

      <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid rgba(220,208,255,0.2)", fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
        <p>See also: <Link to="/terms" style={{ color: "var(--primary)", fontWeight: 500 }}>Terms &amp; Conditions</Link></p>
      </div>
    </div>
  );
}

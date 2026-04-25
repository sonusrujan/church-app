import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usePageMeta } from "../hooks/usePageMeta";

export default function TermsAndConditionsPage() {
  usePageMeta({
    title: "Terms & Conditions – Shalom Church App",
    description: "Terms and conditions for using the Shalom Church App. Understand your rights and responsibilities as a user.",
    canonical: "https://shalomapp.in/terms",
  });
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: "1.5rem", color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>
        <ArrowLeft size={16} /> Back to Home
      </Link>

      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>Terms &amp; Conditions</h1>
      <p style={{ color: "var(--on-surface-variant)", marginBottom: "2rem" }}>Last updated: April 14, 2026</p>

      <section className="prose" style={{ lineHeight: 1.7 }}>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using the Shalom Church App ("the App"), you agree to be bound by these Terms
          &amp; Conditions. If you do not agree, you must not use the App. Continued use of the App
          following any changes to these terms constitutes your acceptance of those changes.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          The Shalom Church App is a church management and member engagement platform that enables
          churches and their members to:
        </p>
        <ul>
          <li>Manage membership records, family relationships, and profiles.</li>
          <li>Process donations and subscription payments securely.</li>
          <li>Coordinate church events, announcements, and prayer requests.</li>
          <li>Communicate through push notifications and SMS.</li>
          <li>Track financial contributions and generate reports for church administration.</li>
        </ul>

        <h2>3. Eligibility</h2>
        <p>
          You must be at least 18 years of age to create an account. Family members under 18 may be
          registered under a parent or guardian's account. By using the App, you represent that you meet
          these eligibility requirements.
        </p>

        <h2>4. Account Registration</h2>
        <ul>
          <li>You must provide a valid Indian mobile phone number for OTP-based authentication.</li>
          <li>You are responsible for maintaining the confidentiality of your account and any OTP codes received.</li>
          <li>You agree to provide accurate and complete information during registration and to keep your profile up to date.</li>
          <li>You must not create accounts for other individuals without their consent.</li>
        </ul>

        <h2>5. Church Membership &amp; Verification</h2>
        <p>
          Your membership in a church through the App is subject to approval by the respective church
          administrator. Church admins may verify, suspend, or revoke your membership at their discretion
          in accordance with church policies.
        </p>

        <h2>6. Payments, Donations &amp; Subscriptions</h2>
        <ul>
          <li>All payments are processed securely through Razorpay, our third-party payment partner, in compliance with PCI-DSS standards.</li>
          <li>Donations made through the App are voluntary contributions to the selected church or diocese.</li>
          <li>Subscription amounts are set by the church administration. Members are responsible for keeping their payment obligations current.</li>
          <li>Payment receipts are generated within the App and may be used for record-keeping purposes.</li>
          <li>Refund requests for donations or subscriptions should be directed to the respective church administrator. Refunds are subject to the church's refund policy.</li>
          <li>The App is not responsible for any payment disputes between members and churches.</li>
        </ul>

        <h2>7. User Conduct</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the App for any unlawful, fraudulent, or harmful purpose.</li>
          <li>Impersonate another person or misrepresent your identity or church affiliation.</li>
          <li>Attempt to gain unauthorized access to other users' accounts, church data, or the App's systems.</li>
          <li>Submit false prayer requests, event information, or membership data.</li>
          <li>Use the App to send spam, unsolicited messages, or engage in harassment of any kind.</li>
          <li>Reverse-engineer, decompile, or attempt to extract the source code of the App.</li>
        </ul>

        <h2>8. Church Administrator Responsibilities</h2>
        <p>Church administrators who use the App agree to:</p>
        <ul>
          <li>Use administrative privileges responsibly and solely for legitimate church management purposes.</li>
          <li>Protect the privacy and personal data of church members.</li>
          <li>Not misuse financial data, payment records, or member information.</li>
          <li>Ensure that any push notifications or SMS messages sent through the App are relevant and appropriate.</li>
        </ul>

        <h2>9. Intellectual Property</h2>
        <p>
          All content, branding, design, and software of the Shalom Church App are the intellectual
          property of Shalom App and are protected under applicable intellectual property laws. You may
          not reproduce, distribute, or create derivative works without prior written consent.
        </p>

        <h2>10. Privacy</h2>
        <p>
          Your use of the App is also governed by our{" "}
          <Link to="/privacy" style={{ color: "var(--primary)", fontWeight: 500 }}>Privacy Policy</Link>,
          which describes how we collect, use, and protect your personal information. By using the App,
          you consent to the practices described in the Privacy Policy.
        </p>

        <h2>11. Push Notifications &amp; Communications</h2>
        <p>
          By using the App, you consent to receive OTP messages for authentication. You may additionally
          opt in to receive push notifications about church events, announcements, and prayer requests.
          You can disable non-essential notifications at any time through your device settings or the
          App's settings page.
        </p>

        <h2>12. Disclaimers</h2>
        <ul>
          <li>The App is provided on an "as is" and "as available" basis without warranties of any kind, either express or implied.</li>
          <li>We do not guarantee uninterrupted or error-free access to the App.</li>
          <li>We are not responsible for the accuracy of content posted by churches, administrators, or other users.</li>
          <li>We do not endorse or verify the religious teachings, practices, or financial management of any church listed on the platform.</li>
        </ul>

        <h2>13. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Shalom App and its developers shall not be liable for
          any indirect, incidental, special, consequential, or punitive damages arising from your use of
          the App, including but not limited to loss of data, financial loss, or damage resulting from
          unauthorized access to your account.
        </p>

        <h2>14. Termination</h2>
        <p>
          We reserve the right to suspend or terminate your access to the App at any time, with or without
          notice, for conduct that we believe violates these Terms or is harmful to other users, churches,
          or the App. Upon termination, your right to use the App ceases immediately.
        </p>

        <h2>15. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of India. Any disputes
          arising from these Terms or your use of the App shall be subject to the exclusive jurisdiction
          of the courts in Hyderabad, Telangana, India.
        </p>

        <h2>16. Changes to These Terms</h2>
        <p>
          We may modify these Terms at any time. Updated terms will be posted in the App with a revised
          "Last updated" date. Your continued use of the App after changes are posted constitutes your
          acceptance of the revised Terms.
        </p>

        <h2>17. Contact</h2>
        <p>
          If you have questions or concerns about these Terms &amp; Conditions, please contact your church
          administrator or reach out to us through the App.
        </p>
      </section>

      <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid rgba(220,208,255,0.2)", fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
        <p>See also: <Link to="/privacy" style={{ color: "var(--primary)", fontWeight: 500 }}>Privacy Policy</Link></p>
      </div>
    </div>
  );
}

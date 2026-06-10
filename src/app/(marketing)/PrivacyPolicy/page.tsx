import Link from "next/link";

export default function page() {
  return (
    <div className="container mx-auto px-4 py-6">
      {/* Back Button */}
      <Link
        href="/"
        className="inline-block mb-4 text-blue-500 hover:underline"
      >
        &larr; Back
      </Link>

      <h1 className="text-3xl font-bold mb-2">Sharetopus Privacy Policy</h1>
      <p className="text-sm text-gray-600 mb-6">Last updated: 05/29/2026</p>

      <div className="prose max-w-none">
        <p>
          Thank you for using Sharetopus (&quot;we&quot;, &quot;our&quot; or
          &quot;us&quot;). This Privacy Policy describes how we collect, use and
          protect your personal and non-personal information when you use our
          website located at{" "}
          <a
            href="https://sharetopus.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://sharetopus.com
          </a>{" "}
          (the &quot;Website&quot;).
        </p>

        <p>
          By accessing or using the Website, you agree to the terms of this
          Privacy Policy. If you do not agree with the practices described in
          this policy, please do not use the Website.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          1. Information we collect
        </h2>
        <h3 className="text-xl font-medium mt-6 mb-3">1.1 Personal data</h3>
        <p>We collect the following personal information:</p>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            <strong>Name:</strong> We collect your name to personalize your
            experience and communicate effectively with you.
          </li>
          <li className="mb-2">
            <strong>Email:</strong> We collect your email address to send you
            important information regarding your account, updates and
            communications.
          </li>
          <li className="mb-2">
            <strong>Payment information:</strong> We collect payment details to
            process your orders securely.
          </li>
          <li className="mb-2">
            <strong>Authentication access keys to social networks:</strong> We
            collect this information to enable cross-posting functionality on
            your social media accounts.
          </li>
        </ul>

        <h3 className="text-xl font-medium mt-6 mb-3">1.2 Non-personal data</h3>
        <p>
          We use web cookies to collect non-personal information such as your IP
          address, browser type, device information and browsing habits. This
          information helps us improve your browsing experience, analyze trends
          and improve our services.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          2. Purpose of data collection
        </h2>
        <p>
          We collect and use your personal data for order processing and social
          media publishing. This includes processing your orders, enabling
          cross-posting functionality, sending confirmations, providing customer
          support and keeping you updated regarding the status of your account
          and your publications.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          3. YouTube API Services
        </h2>
        <p>
          Sharetopus uses YouTube API Services to enable cross-posting
          functionality on YouTube. By using our service to interact with
          YouTube, you are also subject to YouTube&apos;s Terms of Service (
          <Link
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://www.youtube.com/t/terms
          </Link>
          ).
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          4. Google Privacy Policy
        </h2>
        <p>
          As we use YouTube API Services, your data may also be subject to
          Google&apos;s Privacy Policy. For more information on how Google
          collects and processes data, please refer to Google&apos;s Privacy
          Policy at{" "}
          <Link
            href="http://www.google.com/policies/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            http://www.google.com/policies/privacy
          </Link>
          .
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">TikTok</h2>
        <p>
          Sharetopus integrates with the TikTok Content Posting API and TikTok
          Login Kit so you can connect your TikTok account and publish content
          to it directly from Sharetopus. When you connect a TikTok account you
          authorize Sharetopus for a specific set of TikTok permission scopes,
          and Sharetopus accesses and processes only the data those scopes
          cover.
        </p>

        <h3 className="text-xl font-medium mt-6 mb-3">
          Permission scopes we request
        </h3>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            <strong>user.info.basic and user.info.profile:</strong> to identify
            the connected TikTok account and display it inside Sharetopus,
            including the account&apos;s open ID, username, display name, and
            avatar.
          </li>
          <li className="mb-2">
            <strong>user.info.stats:</strong> to display account metrics such as
            follower count and following count.
          </li>
          <li className="mb-2">
            <strong>video.publish:</strong> to publish videos and photos you
            create in Sharetopus directly to your authorized TikTok account
            using the Direct Post flow.
          </li>
        </ul>

        <h3 className="text-xl font-medium mt-6 mb-3">
          What we collect from TikTok
        </h3>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            Your TikTok open ID, username, display name, and avatar URL.
          </li>
          <li className="mb-2">Your follower and following counts.</li>
          <li className="mb-2">
            OAuth access tokens and refresh tokens for your connected account.
          </li>
          <li className="mb-2">
            The publish status and post identifier for content you publish
            through Sharetopus.
          </li>
        </ul>

        <h3 className="text-xl font-medium mt-6 mb-3">How we use this data</h3>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            To show which TikTok account a post will be sent to before you
            publish.
          </li>
          <li className="mb-2">
            To render the posting options TikTok requires (privacy level,
            comment, duet, and stitch settings, and commercial content
            disclosure), retrieved from TikTok when you compose a post.
          </li>
          <li className="mb-2">
            To publish the content you create with the privacy and interaction
            settings you select.
          </li>
          <li className="mb-2">
            To report the status and link of a published post.
          </li>
        </ul>

        <h3 className="text-xl font-medium mt-6 mb-3">
          How we store and protect it
        </h3>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            TikTok access and refresh tokens are stored encrypted and used only
            on Sharetopus servers to call the TikTok API on your behalf. They
            are never exposed to your browser or to other users.
          </li>
          <li className="mb-2">
            Sharetopus does not sell your TikTok data and does not share your
            TikTok personal information with third parties, except as required
            to operate the integration (such as sending your content to TikTok
            at your request) or as required by law.
          </li>
          <li className="mb-2">
            Sharetopus does not add watermarks, logos, or promotional content to
            anything published to your TikTok account.
          </li>
        </ul>

        <h3 className="text-xl font-medium mt-6 mb-3">
          Your control and revocation
        </h3>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            You can disconnect your TikTok account from Sharetopus at any time on
            the Connections page. Disconnecting stops further access and removes
            the stored tokens for that account.
          </li>
          <li className="mb-2">
            You can revoke Sharetopus&apos;s access from your TikTok account
            settings, under Security and permissions, Apps and services.
            Revoking from TikTok invalidates the tokens Sharetopus holds.
          </li>
          <li className="mb-2">
            To request deletion of the TikTok data associated with your
            Sharetopus account, contact Sharetopus at the address in the Contact
            section of this policy.
          </li>
        </ul>

        <p>
          Your use of TikTok through Sharetopus is also subject to the TikTok
          Privacy Policy (
          <Link
            href="https://www.tiktok.com/legal/page/global/privacy-policy/en"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://www.tiktok.com/legal/page/global/privacy-policy/en
          </Link>
          ) and the TikTok Terms of Service (
          <Link
            href="https://www.tiktok.com/legal/page/global/terms-of-service/en"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://www.tiktok.com/legal/page/global/terms-of-service/en
          </Link>
          ).
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">5. Data sharing</h2>
        <p>
          We do not share your personal data with other parties, except when
          necessary for order processing and social media publishing
          functionality. This may include sharing necessary data with social
          media platforms on which you choose to publish, including YouTube via
          YouTube API Services.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          6. Children&apos;s privacy
        </h2>
        <p>
          Sharetopus is not intended for children, and we do not collect any
          data from children.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          7. Privacy policy updates
        </h2>
        <p>
          We may update this Privacy Policy from time to time. Users will be
          informed of any changes by email.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          8. Contact information
        </h2>
        <p>
          If you have any questions, concerns or requests regarding this Privacy
          Policy, you can contact us at:
        </p>
        <p>
          <strong>Email:</strong> sharetopusInc@gmail.com
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          9. Data protection mechanisms
        </h2>
        <p>
          We take the protection of your sensitive data seriously and have
          implemented the following security measure:
        </p>
        <p>
          <strong>a) Encryption:</strong> Your Google OAuth access keys are
          encrypted using industry-standard encryption protocols, both in
          transit and at rest.
        </p>
        <p>
          While we implement this security measure to protect your sensitive
          information, please note that no method of transmission over the
          Internet or method of electronic storage is 100% secure. We strive to
          use commercially acceptable means to protect your personal
          information, but we cannot guarantee its absolute security.
        </p>
        <p>
          By using Sharetopus, you consent to the terms of this Privacy Policy.
        </p>
      </div>
    </div>
  );
}

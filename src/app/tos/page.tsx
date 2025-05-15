// app/terms/page.tsx

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

      <h1 className="text-3xl font-bold mb-2">Sharetopus Terms of Service</h1>
      <p className="text-sm text-gray-600 mb-6">Last updated: 05/04/2025</p>

      <div className="prose max-w-none">
        <p>Welcome to Sharetopus!</p>

        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of the
          Sharetopus website at{" "}
          <a
            href="https://sharetopus.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://sharetopus.com
          </a>{" "}
          (&quot;Website&quot;) and the services provided by Sharetopus. By
          using our Website and services, you accept these Terms.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          1. Description of Sharetopus
        </h2>
        <p>
          Sharetopus is a tool that allows users to simultaneously publish and
          upload content to all social media platforms from a single place.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          2. YouTube Terms of Service
        </h2>
        <p>
          By using Sharetopus to interact with YouTube services, you also agree
          to be bound by YouTube&apos;s Terms of Service (
          <Link
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://www.youtube.com/t/terms
          </Link>
          ). This includes any use of YouTube API Services through our platform.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          3. User Data and Privacy
        </h2>
        <p>
          We collect and store user data, including name, email, payment
          information, and authentication access keys to social networks, as
          needed to provide our services. For more details on how we process
          your data, please refer to our Privacy Policy at{" "}
          <Link
            href="https://sharetopus.com/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://sharetopus.com/privacy-policy
          </Link>
          .
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          4. Collection of Non-Personal Data
        </h2>
        <p>
          We use web cookies to collect non-personal data for the purpose of
          improving our services and user experience.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          5. Ownership and Usage Rights
        </h2>
        <p>
          When you purchase a plan on Sharetopus, you can connect to your social
          media accounts and authorize access to your data to publish on
          platforms connected to the Sharetopus application. You retain
          ownership of your content, but grant us the necessary rights to
          publish on your behalf.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">6. Refund Policy</h2>
        <p>
          We offer a full refund within 24 hours of purchase. To request a
          refund, please contact us at EMAIL.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          7. Children&apos;s Privacy
        </h2>
        <p>
          Sharetopus is not intended to be used by children, and we do not
          knowingly collect any data from children.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          8. Updates to Terms
        </h2>
        <p>
          We may update these Terms from time to time. Users will be informed of
          any changes by email.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">9. Applicable Law</h2>
        <p>These Terms are governed by the laws of Canada.</p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          10. Contact Information
        </h2>
        <p>
          For any questions or concerns regarding these Terms of Service, please
          contact us at{" "}
          <Link href="mailto:" className="text-blue-500 hover:underline">
            ...
          </Link>
          .
        </p>

        <p className="mt-8 font-semibold">Thank you for using Sharetopus!</p>
      </div>
    </div>
  );
}

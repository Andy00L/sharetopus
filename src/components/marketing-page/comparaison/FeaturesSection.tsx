import Image from "next/image";
import proof from "../../../../public/proof.webp";
export default function FeaturesSection() {
  return (
    <section className="py-10 px-10 bg-base-100" id="features">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-12">
          Grow your social reach with
          <span className="text-green-500"> less effort </span>
          for
          <span className="text-green-500"> less money</span>
        </h2>

        <p className="text-gray-800/50 mb-10">Using Sharetopus features...</p>

        <div className="flex flex-col md:flex-row gap-12 md:gap-24">
          <div className="grid grid-cols-1 items-stretch gap-8 sm:gap-12 lg:grid-cols-2 lg:gap-20">
            <ul className="w-full">
              <li>
                <button
                  className="relative flex gap-2 items-center w-full py-5 text-base font-medium text-left md:text-lg"
                  aria-expanded="true"
                >
                  <span className="duration-100 text-green-500">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                      className="size-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                      />
                    </svg>
                  </span>
                  <span className="flex-1 text-base-content text-green-500 font-semibold">
                    <h3 className="inline">Cross-posting</h3>
                  </span>
                </button>
                <div
                  className="transition-all duration-300 ease-in-out text-base-content-secondary overflow-hidden"
                  style={{ opacity: 1 }}
                >
                  <div className="pb-5 leading-relaxed">
                    Upload your content to Sharetopus and post it to any of your
                    connected social media accounts; including posting to all
                    platforms at the same time.
                  </div>
                </div>
              </li>

              <li>
                <button
                  className="relative flex gap-2 items-center w-full py-5 text-base font-medium text-left md:text-lg"
                  aria-expanded="false"
                >
                  <span className="duration-100">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                      className="size-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z"
                      />
                    </svg>
                  </span>
                  <span className="flex-1 text-base-content">
                    <h3 className="inline">Scheduling</h3>
                  </span>
                </button>
                <div
                  className="transition-all duration-300 ease-in-out text-base-content-secondary overflow-hidden"
                  style={{ maxHeight: 0, opacity: 0 }}
                >
                  <div className="pb-5 leading-relaxed">
                    Schedule your content to be posted on your social accounts
                    at the perfect time.
                  </div>
                </div>
              </li>

              <li>
                <button
                  className="relative flex gap-2 items-center w-full py-5 text-base font-medium text-left md:text-lg"
                  aria-expanded="false"
                >
                  <span className="duration-100">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                      className="size-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                      />
                    </svg>
                  </span>
                  <span className="flex-1 text-base-content">
                    <h3 className="inline">Content management</h3>
                  </span>
                </button>
                <div
                  className="transition-all duration-300 ease-in-out text-base-content-secondary overflow-hidden"
                  style={{ maxHeight: 0, opacity: 0 }}
                >
                  <div className="pb-5 leading-relaxed">
                    View all of your posted content and scheduled content in one
                    place, edit scheduled posts and view your past posts.
                  </div>
                </div>
              </li>

              <li>
                <button
                  className="relative flex gap-2 items-center w-full py-5 text-base font-medium text-left md:text-lg"
                  aria-expanded="false"
                >
                  <span className="duration-100">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                      className="size-6 cursor-pointer"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 2.25a1.5 1.5 0 0 1 1.5 1.5v1.5h-3V3.75A1.5 1.5 0 0 1 12 2.25zM4.5 6h15a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V7.5A1.5 1.5 0 0 1 4.5 6zM6 9h12v9H6V9z"
                      />
                    </svg>
                  </span>
                  <span className="flex-1 text-base-content">
                    <h3 className="inline">Content Studio</h3>
                    <span className="text-sm text-gray-800/50">
                      (comming soon)
                    </span>
                  </span>
                </button>
                <div
                  className="transition-all duration-300 ease-in-out text-base-content-secondary overflow-hidden"
                  style={{ maxHeight: 0, opacity: 0 }}
                >
                  <div className="pb-5 leading-relaxed">
                    Proven viral templates to create content for your brand in
                    minutes. (The same templates we&apos;ve used to get over
                    60,000 app downloads to our own apps) Drag and drop using
                    our video maker and get 1000s of potential customers to your
                    page
                  </div>
                </div>
              </li>
            </ul>

            <div className="rounded-2xl aspect-square w-full sm:w-[26rem]">
              <Image
                className="w-full h-full object-cover rounded-2xl"
                src={proof}
                alt="Result proof"
                width="500"
                height="500"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

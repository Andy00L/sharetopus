import {
  Maximize2,
  Clock,
  History,
  Image,
  BarChart,
  Pen,
  Upload,
  Users,
} from "lucide-react";

export default function Features() {
  return (
    <section
      id="features"
      className="w-full flex justify-center py-16 md:py-24 bg-slate-50"
    >
      <div className="container px-4">
        <div className="mx-auto max-w-3xl text-center mb-16">
          <div className="inline-block px-3 py-1 mb-6 rounded-full bg-primary/10 text-primary font-medium">
            Powerful Features
          </div>
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Everything you need to streamline your social media workflow
          </h2>
          <p className="text-lg text-muted-foreground">
            Sharetopus gives you the tools to create, manage, and publish
            content across multiple platforms - all from one dashboard.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Feature 1 */}
          <div className="flex flex-col p-6 rounded-lg border bg-white hover:shadow-md transition-shadow">
            <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
              <Upload size={24} className="text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">Single Upload</h3>
            <p className="text-muted-foreground">
              Upload your video or image content just once and distribute it to
              all your connected social media accounts.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="flex flex-col p-6 rounded-lg border bg-white hover:shadow-md transition-shadow">
            <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
              <Pen size={24} className="text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">
              Platform-Specific Captions
            </h3>
            <p className="text-muted-foreground">
              Customize captions and hashtags for each platform while
              maintaining your core message across all channels.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="flex flex-col p-6 rounded-lg border bg-white hover:shadow-md transition-shadow">
            <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
              <Clock size={24} className="text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">Smart Scheduling</h3>
            <p className="text-muted-foreground">
              Schedule posts for the optimal time on each platform to maximize
              engagement and reach.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="flex flex-col p-6 rounded-lg border bg-white hover:shadow-md transition-shadow">
            <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
              <Users size={24} className="text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">
              Multi-Account Management
            </h3>
            <p className="text-muted-foreground">
              Connect multiple accounts from each platform and manage them all
              from a single dashboard.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="flex flex-col p-6 rounded-lg border bg-white hover:shadow-md transition-shadow">
            <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
              <Maximize2 size={24} className="text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">
              Cross-Platform Analytics
            </h3>
            <p className="text-muted-foreground">
              Track performance metrics across all your social platforms in one
              unified analytics dashboard.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="flex flex-col p-6 rounded-lg border bg-white hover:shadow-md transition-shadow">
            <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
              <Image size={24} className="text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">Content Library</h3>
            <p className="text-muted-foreground">
              Store and organize all your media assets in one place for quick
              access and reuse across campaigns.
            </p>
          </div>
        </div>

        <div className="mt-16 max-w-4xl mx-auto bg-white border rounded-lg p-8 shadow-sm">
          <div className="flex flex-col md:flex-row gap-8 items-center">
            <div className="flex-1">
              <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
                <History size={24} className="text-primary" />
              </div>
              <h3 className="text-2xl font-medium mb-4">
                Save Hours Every Week
              </h3>
              <p className="text-muted-foreground mb-4">
                Social media managers save an average of 8 hours per week by
                using Sharetopus to streamline their posting workflow.
              </p>
              <div className="flex items-center">
                <BarChart size={24} className="text-primary mr-2" />
                <span className="font-semibold">93% of users</span>
                <span className="ml-2">report increased productivity</span>
              </div>
            </div>
            <div className="flex-1 relative md:pl-8 md:border-l">
              <div className="bg-muted rounded-lg p-4">
                <blockquote className="text-foreground italic">
                  &quot;I used to spend hours copy-pasting content between
                  platforms. With Sharetopus, I can plan and schedule an entire
                  week&apos;s worth of content across all my channels in just
                  one sitting.&quot;
                </blockquote>
                <div className="mt-4 flex items-center">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                    SM
                  </div>
                  <div className="ml-3">
                    <p className="font-medium">Sarah Miller</p>
                    <p className="text-sm text-muted-foreground">
                      Content Creator
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

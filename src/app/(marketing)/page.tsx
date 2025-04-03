import Cta from "@/components/marketing-page/cta";
import Features from "@/components/marketing-page/feature";
import Footer from "@/components/marketing-page/footer";
import Hero from "@/components/marketing-page/hero";
import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import Pricing from "@/components/marketing-page/pricing";

export default function page() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="flex-1">
        <div className="bg-white ">
          <Hero />
          <Features />
          <Pricing />
          <Cta />
        </div>
      </div>
      <Footer />
    </div>
  );
}

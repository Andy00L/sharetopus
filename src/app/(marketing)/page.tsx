import StatsBand from "@/components/marketing-page/comparaison/StatsSection";
import ContentManagement from "@/components/marketing-page/ContentManagement";
import Faq from "@/components/marketing-page/faq";
import Footer from "@/components/marketing-page/footer";
import HeroV2 from "@/components/marketing-page/hero-v2/hero";
import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import Pricing from "@/components/marketing-page/pricing";
import Scheduling from "@/components/marketing-page/Scheduling";
import TestimonialsSection from "@/components/marketing-page/testimonial";
import ViralFormats from "@/components/marketing-page/viral";
import SupportedPlatforms from "@/components/marketing-page/SupportedPlatforms";
import Crossposting from "@/components/marketing-page/crossposting";

export default function page() {
  return (
    <div className="flex min-h-screen flex-col scroll-smooth">
      <Navbar />
      <div className="flex-1 scroll-smooth">
        <div>
          <HeroV2 />
          <TestimonialsSection />
          <Crossposting />
          <Scheduling />
          <ContentManagement />
          {/*  <ProblemsSection /> */}

          {/*  <FeaturesSection /> */}

          <StatsBand />
          {/* <HeroVisuals /> */}

          <ViralFormats />
          <SupportedPlatforms />
          <Pricing />
          <Faq />
        </div>
      </div>
      <Footer />
    </div>
  );
}

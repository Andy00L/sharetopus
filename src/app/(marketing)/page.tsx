import AlternativesSection from "@/components/marketing-page/AlternativesSection";
import FeaturesSection from "@/components/marketing-page/comparaison/FeaturesSection";
import ProblemsSection from "@/components/marketing-page/comparaison/ProblemsSection";
import StatsSection from "@/components/marketing-page/comparaison/StatsSection";
import Crossposting from "@/components/marketing-page/crossposting";
import Faq from "@/components/marketing-page/faq";
import Footer from "@/components/marketing-page/footer";
import HeroV2 from "@/components/marketing-page/hero-v2/hero";
import HeroVisuals from "@/components/marketing-page/HeroVisuals";
import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import Pricing from "@/components/marketing-page/pricing";
import TestimonialsSection from "@/components/marketing-page/testimonial";

export default function page() {
  return (
    <div className="flex min-h-screen flex-col scroll-smooth">
      <Navbar />
      <div className="flex-1 scroll-smooth">
        <div>
          <HeroV2 />

          <TestimonialsSection />

          <ProblemsSection />

          <FeaturesSection />

          <StatsSection />
          <HeroVisuals />
          <AlternativesSection />
          <Crossposting />
          <Pricing />
          <Faq />
        </div>
      </div>
      <Footer />
    </div>
  );
}

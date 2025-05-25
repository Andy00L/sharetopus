import AlternativesSection from "@/components/marketing-page/AlternativesSection";
import FeaturesSection from "@/components/marketing-page/comparaison/FeaturesSection";
import ProblemsSection from "@/components/marketing-page/comparaison/ProblemsSection";
import StatsSection from "@/components/marketing-page/comparaison/StatsSection";
import Footer from "@/components/marketing-page/footer";
import Hero from "@/components/marketing-page/hero/hero";
import HeroVisuals from "@/components/marketing-page/HeroVisuals";
import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import Pricing from "@/components/marketing-page/pricing";
import TestimonialsSection from "@/components/marketing-page/testimonial";

export default function page() {
  return (
    <div className="flex min-h-screen flex-col scroll-smooth bg-white">
      <Navbar />
      <div className="flex-1 scroll-smooth">
        <div>
          <Hero />

          <TestimonialsSection />

          <ProblemsSection />

          <FeaturesSection />

          <StatsSection />
          <HeroVisuals />
          <AlternativesSection />
          <Pricing />
        </div>
      </div>
      <Footer />
    </div>
  );
}

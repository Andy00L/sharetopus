import Image from "next/image";

const partners = [
  { name: "ICICI Bank", logo: "/partners/icici.svg" },
  { name: "HDFC Bank", logo: "/partners/hdfc.svg" },
  { name: "HSBC", logo: "/partners/hsbc.svg" },
  { name: "Izibank", logo: "/partners/izibank1.svg" },
  { name: "Izibank", logo: "/partners/izibank2.svg" },
];

export default function Partners() {
  return (
    <section className="py-10 bg-blue-50">
      <div className="container px-4 mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 lg:gap-16">
          {partners.map((partner) => (
            <div key={partner.logo} className="relative h-8 w-28">
              <Image
                src={partner.logo}
                alt={partner.name}
                fill
                className="object-contain opacity-70"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

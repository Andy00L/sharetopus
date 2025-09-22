import Image from "next/image";
import hero from "../../../public/heroPreview.webp";
export default function HeroVisuals() {
  const blurElements = [
    { position: "-top-42 -left-42", color: "#D7E5FF" },
    { position: "-top-42 -right-42", color: "#FFD8D8" },
    { position: "-bottom-32 -left-42", color: "#F6FFCC" },
    { position: "-bottom-42 -right-42", color: "#D8FFE6" },
  ];

  return (
    <div className="hidden   mx-auto md:block relative w-full max-w-[1000px] mt-4 align-middle">
      {blurElements.map((element, index) => (
        <svg
          key={index}
          className={`absolute ${element.position} w-[700px] h-[700px] blur-[70px] opacity-100 pointer-events-none`}
          viewBox="0 0 100 100"
        >
          <polygon
            points="50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35"
            fill={element.color}
          />
        </svg>
      ))}
      <Image
        src={hero}
        width={1000} // ✅ numbers
        height={1000}
        className="w-full relative z-10 rounded-lg"
        alt="Hero"
      />
    </div>
  );
}

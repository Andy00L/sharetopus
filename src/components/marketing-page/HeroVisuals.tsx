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
      {/* Hero Text Section
      <div className="text-center mb-12">
        <h2 className="text-4xl md:text-5xl font-bold mb-6">
          Create
          <span className="text-green-600 mx-2">Viral Videos</span>
          in Seconds
        </h2>
        <p className="text-xl text-base-content/70 max-w-3xl mx-auto">
          Stop spending hours on content creation. Use our Content Studio -
          packed with proven viral templates - to create engaging videos that
          drive{" "}
          <button className="text-green-600 hover:underline font-semibold inline-flex items-center gap-1 group">
            real results
            <svg
              stroke="currentColor"
              fill="currentColor"
              strokeWidth="0"
              viewBox="0 0 512 512"
              className="w-4 h-4 opacity-70 group-hover:opacity-100 transition-opacity"
              height="1em"
              width="1em"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M256 8C119.043 8 8 119.083 8 256c0 136.997 111.043 248 248 248s248-111.003 248-248C504 119.083 392.957 8 256 8zm0 110c23.196 0 42 18.804 42 42s-18.804 42-42 42-42-18.804-42-42 18.804-42 42-42zm56 254c0 6.627-5.373 12-12 12h-88c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h12v-64h-12c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h64c6.627 0 12 5.373 12 12v100h12c6.627 0 12 5.373 12 12v24z" />
            </svg>
          </button>
          .
        </p>
      </div> */}

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

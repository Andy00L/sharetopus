import drewecom from "../../../public/drewecom.jpg";
import quinn from "../../../public/quinn.jpg";
import AvatarWithFallback from "../AvatarWithFallback";
import { StaticImageData } from "next/image";

const testimonials: Testimonial[] = [
  {
    name: "Andrew ",
    avatar: drewecom,
    rating: 5,
    text: "Helped me make $96k in profit last month on tiktok shop. Shoutout to  @Andy00L for the software",
  },
  {
    name: "Quinn ",
    avatar: quinn,
    rating: 5,
    text: "[Sharetopus] responded within 10 mins [of support request], fixed and shipped in under an hour, the type of founders I’m happy to support",
  },
];
interface Testimonial {
  name: string;
  avatar: StaticImageData;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
}

const StarIcon = () => (
  <svg className="w-4 h-4 text-[var(--orange)] fill-current" viewBox="0 0 20 20">
    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
  </svg>
);

function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div className="p-4 bg-[var(--cream-2)] border border-[var(--line-2)] flex items-start text-left rounded-[16px] shadow">
      <AvatarWithFallback
        src={testimonial.avatar.src}
        alt={`${testimonial.name} ReelFarm`}
        className="w-12 h-12"
      />
      <div className="ml-3">
        <div className="flex mb-1">
          {[...Array(testimonial.rating).keys()].map((starIndex) => (
            <StarIcon key={starIndex} />
          ))}
        </div>
        <p className="text-sm font-semibold text-[var(--ink)]">
          {testimonial.name}
        </p>
        <p className="text-sm text-[var(--muted)] mr-4">{testimonial.text}</p>
      </div>
    </div>
  );
}

export default function TestimonialsSection() {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-10  mt-4 mb-4 z-99">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-[900px]">
        {testimonials.map((testimonial, index) => (
          <TestimonialCard key={index} testimonial={testimonial} />
        ))}
      </div>
    </div>
  );
}

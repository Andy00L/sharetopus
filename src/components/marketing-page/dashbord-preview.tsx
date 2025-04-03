import Image from "next/image";

export default function DashboardPreview() {
  return (
    <section className="py-12 md:py-16">
      <div className="container">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm">
          <Image
            src="/dashboard-preview.png"
            alt="CardScout Dashboard"
            width={1000}
            height={600}
            className="w-full"
          />
        </div>
      </div>
    </section>
  );
}

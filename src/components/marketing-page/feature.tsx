export default function Features() {
  return (
    <section className="w-full flex justify-center py-16 md:py-24">
      <div className="container">
        <div className="mx-auto max-w-3xl text-center mb-12">
          <h2 className="text-3xl font-medium tracking-tight">
            Smarter card management
          </h2>
          <p className="mt-4 text-lg text-[var(--muted-foreground)]">
            Everything you need to find and manage the perfect credit cards for
            you.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <div className="p-6 rounded-lg border border-[var(--border)] bg-white">
            <h3 className="text-xl font-medium">data</h3>
            <p className="mt-2 text-[var(--muted-foreground)]">Features</p>
          </div>
        </div>
      </div>
    </section>
  );
}

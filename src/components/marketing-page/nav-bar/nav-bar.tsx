import Link from "next/link";
import { NavigationItems } from "./nav";

export default function Navbar() {
  return (
    <header className="w-full flex justify-center p-7 ">
      <div className="container z-50 flex items-center justify-between mx-auto gap-x-20 max-w-7xl ">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-medium">CardScout</span>
        </Link>

        <nav className="hidden md:block">
          <NavigationItems />
        </nav>

        <div className="flex items-center space-x-4">
          <Link
            href="/dashboard"
            className="text-sm bg-[var(--primary)] text-[var(--primary-foreground)] px-4 py-2 rounded-md hover:bg-[var(--primary)]/90"
          >
            Try for free
          </Link>
        </div>
      </div>
    </header>
  );
}

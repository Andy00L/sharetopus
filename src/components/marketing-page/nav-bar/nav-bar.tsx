import Link from "next/link";
import { NavigationItems } from "./nav-items";
import logo from "../../../../public/trans_logo (1).webp";
import Image from "next/image";
export default function Navbar() {
  return (
    <header className="w-full flex justify-center p-7 ">
      <div className="container z-50 flex items-center justify-between mx-auto gap-x-20 max-w-7xl ">
        <Link href="/create" className="flex items-center space-x-2">
          <Image src={logo} alt="Sharetopus logo" height={42} width={42} />
          <span className="text-xl font-medium">Sharetopus</span>
        </Link>

        <nav className="hidden md:block">
          <NavigationItems />
        </nav>

        <div className="flex items-center space-x-4">
          <Link
            href="/create"
            className="text-sm bg-[var(--primary)] text-[var(--primary-foreground)] px-4 py-2 rounded-md hover:bg-[var(--primary)]/90"
          >
            Sign Up - It&apos;s Free
          </Link>
        </div>
      </div>
    </header>
  );
}

import { Button } from "@/components/ui/button";
import { auth } from "@clerk/nextjs/server";
import Image from "next/image";
import Link from "next/link";
import logo from "../../../../public/trans_logo (1).webp";
import { NavigationItems } from "./nav-items";
export default async function Navbar() {
  const { userId } = await auth();

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
          {!userId ? (
            <Button className="px-4 py-2 rounded-full font-medium cursor-pointer">
              <Link href="/create">Sign In</Link>
            </Button>
          ) : (
            <Button className="px-4 py-2 rounded-full font-medium cursor-pointer">
              <Link href="/create">Hey friend :)</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

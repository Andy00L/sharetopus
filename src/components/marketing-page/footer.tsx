import { CreditCard, Heart, Mail, MessageSquare } from "lucide-react";
import Link from "next/link";

export default function Footer() {
  const currentYear = new Date().getFullYear();
  return (
    <footer className="bg-secondary py-16 ">
      <div className="container mx-auhref px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 ">
          <div>
            <div className="flex items-center mb-4">
              <span className="font-display text-2xl font-semibold tracking-tight">
                CardScout
              </span>
            </div>
            <p className="text-muted-foreground mb-6">
              Helping Canadians find the best credit cards for their lifestyle
              and financial goals.
            </p>
            <div className="flex space-x-4">
              <Link
                href="/app"
                className="h-10 w-10 flex items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <CreditCard size={18} />
              </Link>
              <Link
                href="/app"
                className="h-10 w-10 flex items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Mail size={18} />
              </Link>
              <Link
                href="/app"
                className="h-10 w-10 flex items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <MessageSquare size={18} />
              </Link>
            </div>
          </div>

          {/*Credit Cards section */}
          <div>
            <h3 className="font-semibold text-lg mb-4">Credit Cards</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/app"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  app
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-4">Resources</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="#paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Blog
                </Link>
              </li>
              <li>
                <Link
                  href="#paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Credit Guides
                </Link>
              </li>
              <li>
                <Link
                  href="paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  FAQ
                </Link>
              </li>
              <li>
                <Link
                  href="#paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Credit Card Terms
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-4">Company</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="#paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  About Us
                </Link>
              </li>
              <li>
                <Link
                  href="#paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Contact
                </Link>
              </li>
              <li>
                <Link
                  href="#paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="#paid"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border mt-12 pt-8 flex flex-col md:flex-row justify-between items-center text-sm text-muted-foreground">
          <p>© {currentYear} CardScouts. All rights reserved.</p>
          <p className="mt-4 md:mt-0 flex items-center">
            Made with <Heart size={14} className="mx-1 text-primary" /> in
            Canada
          </p>
        </div>
      </div>
    </footer>
  );
}

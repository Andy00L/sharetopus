"use client";

import { Plus, Minus } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* FAQ items. Prices match planPrices in plans.ts ($9/$18/$27).
   Platform list matches docs/PLATFORMS.md (LinkedIn, TikTok, Pinterest, Instagram). */
const FAQ_ITEMS = [
  {
    id: "f1",
    q: "How does Sharetopus actually post to all platforms?",
    a: "You connect each social account once via the official APIs. Sharetopus stores secure tokens, then publishes natively. No bots, no redirects.",
  },
  {
    id: "f2",
    q: "Can I tweak captions per platform?",
    a: "Yes. Draft once, then override caption, hashtags, or media per platform right in the composer.",
  },
  {
    id: "f3",
    q: "Do I need a credit card to start?",
    a: "Yes. Sharetopus is paid from day one ($9, $18, or $27 per month). No free trials. Cancel anytime.",
  },
  {
    id: "f4",
    q: "How is this different from Buffer or Hootsuite?",
    a: "Price and focus. We don't charge enterprise rates for solo creators, and we don't bundle inbox, listening, or CRM modules you won't use.",
  },
  {
    id: "f5",
    q: "Can teams use Sharetopus?",
    a: "Yes. Pro ($27/mo) supports unlimited connected accounts and works for larger organizations.",
  },
  {
    id: "f6",
    q: "What platforms are supported today?",
    a: "LinkedIn, TikTok, Pinterest, and Instagram. More on the way.",
  },
];

/* FAQ section. Centered heading with serif-italic accent.
   Uses shadcn Accordion in single-expand collapsible mode.
   The default ChevronDownIcon from the AccordionTrigger is hidden via
   [&>svg]:hidden. A custom icon span shows Plus when closed and Minus
   when open, with an orange filled-circle background on the open state.
   The group class on the trigger + group-data-[state=open] variants
   on children handle the state-dependent styling. */
export default function Faq() {
  return (
    <section
      id="faq"
      className="py-16 md:py-24 px-4 md:px-8 max-w-4xl mx-auto"
    >
      {/* Section header. */}
      <div className="text-center mb-8 md:mb-12">
        <div className="t-eyebrow mb-3">
          <span className="inline-block size-1.5 rounded-full bg-primary mr-2 align-middle" />
          FAQ
        </div>
        <h2 className="t-section-h2">
          Frequently asked{" "}
          <span className="t-section-accent">questions.</span>
        </h2>
        <p className="t-section-sub max-w-xl mx-auto mt-4">
          Still curious? Email jack@sharetopus.com. A human will reply.
        </p>
      </div>

      {/* Accordion. Single-expand: only one item open at a time.
          collapsible: clicking the open item closes it. */}
      <Accordion type="single" collapsible className="w-full">
        {FAQ_ITEMS.map((item) => (
          <AccordionItem
            key={item.id}
            value={item.id}
            className="border-t border-[var(--line-2)] last:border-b border-b-0 py-2"
          >
            {/* Trigger: question text left, plus/minus icon right.
                group class enables group-data-[state=open] on children.
                [&>svg]:hidden hides the default ChevronDownIcon (direct SVG child).
                Our Plus/Minus are inside a span, so they are unaffected. */}
            <AccordionTrigger className="group hover:no-underline py-5 [&>svg]:hidden">
              <span className="t-faq-q text-left flex-1">
                {item.q}
              </span>
              <span className="size-8 rounded-full border border-foreground/60 flex items-center justify-center shrink-0 transition-colors group-data-[state=open]:bg-primary group-data-[state=open]:border-primary group-data-[state=open]:text-white">
                <Plus className="size-3.5 group-data-[state=open]:hidden" />
                <Minus className="size-3.5 hidden group-data-[state=open]:block" />
              </span>
            </AccordionTrigger>
            <AccordionContent className="t-faq-a pr-12 pb-5">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

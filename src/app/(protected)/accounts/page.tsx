"use client";
import { Button } from "@/components/ui/button";

export default function ManageAccountsPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Manage Social Media Accounts</h1>
        <p className="text-muted-foreground mt-2">
          Connect your social media accounts to publish content across
          platforms.
        </p>
      </header>

      <div className="mt-12 border-t pt-6">
        <h2 className="text-lg font-medium mb-4">
          Need help connecting accounts?
        </h2>
        <p className="text-muted-foreground mb-6">
          If youre experiencing issues connecting your social media accounts,
          check our troubleshooting guide or contact support.
        </p>
        <div className="flex gap-4">
          <Button variant="outline">View Troubleshooting Guide</Button>
          <Button variant="secondary">Contact Support</Button>
        </div>
      </div>
    </div>
  );
}

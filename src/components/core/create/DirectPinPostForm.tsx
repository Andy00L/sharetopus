"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PinterestBoard,
  getPinterestBoards,
} from "@/lib/api/pinterest/data/getPinterestBoards";
import { SocialAccount } from "@/lib/types/dbTypes";
import { Loader2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"];
const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

interface DirectPinPostFormProps {
  readonly accounts: SocialAccount[];
  readonly userId: string | null;
}

export default function DirectPinPostForm({
  accounts,
  userId,
}: DirectPinPostFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [link, setLink] = useState<string>("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [boards, setBoards] = useState<PinterestBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingBoards, setIsLoadingBoards] = useState<boolean>(false);

  // Filter Pinterest accounts
  const pinterestAccounts = accounts.filter(
    (account) => account.platform === "pinterest"
  );

  // Load boards when account is selected
  useEffect(() => {
    if (!selectedAccountId) return;

    const loadBoards = async () => {
      setIsLoadingBoards(true);
      setError(null);
      setBoards([]);

      try {
        const account = accounts.find((acc) => acc.id === selectedAccountId);
        console.log(account);
        if (!account || account.platform !== "pinterest") {
          throw new Error("Invalid Pinterest account");
        }

        const fetchedBoards = await getPinterestBoards(account.access_token);
        setBoards(fetchedBoards);

        if (fetchedBoards.length === 0) {
          setError(
            "No Pinterest boards found. Please create a board on Pinterest first."
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load boards");
      } finally {
        setIsLoadingBoards(false);
      }
    };

    loadBoards();
  }, [selectedAccountId, accounts]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast("Please select a valid image file (JPEG, PNG).");
      return;
    }

    // Validate file size
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      toast(`Maximum file size is ${MAX_IMAGE_SIZE_MB}MB.`);
      return;
    }

    setImageFile(file);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!userId) {
      setError("You must be logged in");
      return;
    }

    if (!selectedAccountId || !selectedBoardId || !imageFile || !title) {
      setError("Please fill all required fields");
      return;
    }

    setIsLoading(true);

    try {
      // Get the selected account
      const account = accounts.find((acc) => acc.id === selectedAccountId);
      console.log("TESTO", account);
      if (!account?.access_token) {
        throw new Error("Invalid Pinterest account or missing token");
      }
      console.log(imageFile);
      // Convert file to base64 directly
      const base64Data = await readFileAsBase64(imageFile);
      console.log("[En cours d'envoi]");
      // Post directly to Pinterest
      const data = await fetch("/api/social/post/pinterest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: account.access_token,
          boardId: selectedBoardId,
          base64Image: base64Data,
          mediaType: imageFile.type,
          title,
          description,
          link,
        }),
      });
      console.log(data);

      toast("Your Pin has been published to Pinterest");

      // Reset form
      setTitle("");
      setDescription("");
      setLink("");
      setImageFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post Pin");
      toast("Failed to post Pin");
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to read file as base64
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result contains the base64 data URL
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Post Directly to Pinterest</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Pinterest Account Selection */}
            <div className="space-y-2">
              <Label htmlFor="account">Pinterest Account</Label>
              <Select
                value={selectedAccountId}
                onValueChange={setSelectedAccountId}
                disabled={isLoading}
              >
                <SelectTrigger id="account">
                  <SelectValue placeholder="Select a Pinterest account" />
                </SelectTrigger>
                <SelectContent>
                  {pinterestAccounts.length === 0 ? (
                    <SelectItem value="no-accounts" disabled>
                      No Pinterest accounts connected
                    </SelectItem>
                  ) : (
                    pinterestAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.display_name ??
                          account.username ??
                          `Account ${account.account_identifier.substring(
                            0,
                            8
                          )}`}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Board Selection */}
            {selectedAccountId && (
              <div className="space-y-2">
                <Label htmlFor="board">Pinterest Board</Label>
                <Select
                  value={selectedBoardId}
                  onValueChange={setSelectedBoardId}
                  disabled={isLoading || isLoadingBoards}
                >
                  <SelectTrigger id="board">
                    <SelectValue
                      placeholder={
                        isLoadingBoards ? "Loading boards..." : "Select a board"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {isLoadingBoards && (
                      <SelectItem value="loading" disabled>
                        Loading boards...
                      </SelectItem>
                    )}

                    {!isLoadingBoards && boards.length === 0 && (
                      <SelectItem value="no-boards" disabled>
                        No boards available
                      </SelectItem>
                    )}

                    {!isLoadingBoards &&
                      boards.length > 0 &&
                      boards.map((board) => (
                        <SelectItem key={board.id} value={board.id}>
                          {board.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Image Upload */}
            <div className="space-y-2">
              <Label htmlFor="image">Pin Image</Label>
              <Input
                id="image"
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(",")}
                onChange={handleFileChange}
                disabled={isLoading}
                ref={fileInputRef}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              {imageFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {imageFile.name} (
                  {(imageFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>

            {/* Pin Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Pin Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a title for your pin"
                disabled={isLoading}
                required
              />
            </div>

            {/* Pin Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a detailed description for your pin"
                disabled={isLoading}
                rows={3}
              />
            </div>

            {/* Destination Link */}
            <div className="space-y-2">
              <Label htmlFor="link">Destination Link (Optional)</Label>
              <Input
                id="link"
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://example.com"
                disabled={isLoading}
              />
            </div>

            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              disabled={
                isLoading ||
                !selectedAccountId ||
                !selectedBoardId ||
                !imageFile ||
                !title
              }
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Posting...
                </>
              ) : (
                <>
                  <UploadCloud className="mr-2 h-4 w-4" />
                  Post to Pinterest
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

// components/core/schedule/platform-options/PinterestOptions.tsx
"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, InfoIcon, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  PinterestBoard,
  getPinterestBoards,
} from "@/lib/api/pinterest/data/getPinterestBoards";
import {
  PinterestOptions,
  PrivacyLevel,
  SocialAccount,
} from "@/lib/types/dbTypes";

interface PinterestOptionsProps {
  readonly options: PinterestOptions;
  readonly onChange: (options: PinterestOptions) => void;
  readonly disabled?: boolean;
  readonly accountId?: string;
  readonly accounts?: SocialAccount[];
}

export function PinterestPostOptions({
  options,
  onChange,
  disabled = false,
  accountId,
  accounts = [],
}: PinterestOptionsProps) {
  const [boards, setBoards] = useState<PinterestBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [retryCount, setRetryCount] = useState(0);
  const [customBoardId, setCustomBoardId] = useState("");
  const [customBoardName, setCustomBoardName] = useState("");
  const [showCustomBoardDialog, setShowCustomBoardDialog] = useState(false);

  // Handler for privacy level change
  const handlePrivacyChange = (value: PrivacyLevel) => {
    onChange({
      ...options,
      privacyLevel: value,
    });
  };

  // Handler for board selection
  const handleBoardChange = (value: string) => {
    onChange({
      ...options,
      board: value,
    });
  };

  // Handler for link change
  const handleLinkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...options,
      link: e.target.value,
    });
  };

  // Force refresh boards
  const handleRefreshBoards = () => {
    setRetryCount((prev) => prev + 1);
  };

  // Handle adding a custom board
  const handleAddCustomBoard = () => {
    if (!customBoardId.trim() || !customBoardName.trim()) {
      return;
    }

    const newBoard: PinterestBoard = {
      id: customBoardId.trim(),
      name: customBoardName.trim(),
    };

    // Add to boards
    setBoards((prev) => [...prev, newBoard]);

    // Select this board
    onChange({
      ...options,
      board: customBoardId.trim(),
    });

    // Reset form and close dialog
    setCustomBoardId("");
    setCustomBoardName("");
    setShowCustomBoardDialog(false);
  };

  // Fetch boards when account ID changes or when manually refreshed
  useEffect(() => {
    async function loadBoards() {
      if (!accountId) return;
      console.log(
        "[Debug] Available accounts:",
        accounts.map((acc) => ({
          id: acc.id,
          platform: acc.platform,
          hasToken: !!acc.access_token,
          tokenPreview: acc.access_token?.slice(0, 10) + "...",
        }))
      );
      setLoading(true);
      setError(null);
      setDebugInfo("");

      try {
        // Find the selected Pinterest account
        const account = accounts.find((acc) => acc.id === accountId);

        if (!account || account.platform !== "pinterest") {
          console.log("[Pinterest] No account found for ID:", accountId);
          setDebugInfo(
            `Aucun compte Pinterest trouvé pour l&apos;ID: ${accountId}`
          );
          setBoards([]);
          setLoading(false);
          return;
        }

        // Log account details
        const accountInfo = {
          id: account.id,
          platform: account.platform,
          hasToken: !!account.access_token,
          tokenFragment: account.access_token
            ? `${account.access_token.substring(0, 10)}...`
            : "none",
          username: account.username,
          accountIdentifier: account.account_identifier,
        };

        console.log("[Pinterest] Using account:", accountInfo);
        setDebugInfo(
          (prev) => prev + `\nCompte: ${JSON.stringify(accountInfo, null, 2)}`
        );

        // Check token
        if (!account.access_token) {
          setError("Pas de token d&apos;accès pour ce compte Pinterest");
          setBoards([]);
          setLoading(false);
          return;
        }

        // Attempt to fetch boards
        setDebugInfo((prev) => prev + "\nRécupération des tableaux...");

        // Fetch boards
        const fetchedBoards = await getPinterestBoards(
          account.access_token,
          account.id
        );
        console.log(fetchedBoards);
        setDebugInfo(
          (prev) => prev + `\nTableaux récupérés: ${fetchedBoards.length}`
        );

        setBoards(fetchedBoards);

        if (fetchedBoards.length > 0) {
          setDebugInfo(
            (prev) =>
              prev +
              `\nTableaux disponibles: ${JSON.stringify(
                fetchedBoards.map((b) => ({ id: b.id, name: b.name }))
              )}`
          );
        } else {
          setError(
            "Aucun tableau Pinterest détecté. Utilisez le bouton &apos;+ Ajouter manuellement&apos; pour ajouter un tableau."
          );
        }
      } catch (err) {
        console.error("[Pinterest] Error fetching boards:", err);
        setError(
          `Erreur: ${err instanceof Error ? err.message : "Erreur inconnue"}`
        );
        setDebugInfo((prev) => prev + `\nErreur: ${JSON.stringify(err)}`);
        setBoards([]);
      } finally {
        setLoading(false);
      }
    }

    console.log(
      "[Pinterest] Loading boards for account:",
      accountId,
      "retry:",
      retryCount
    );
    loadBoards();
  }, [accountId, accounts, retryCount]);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Options Pinterest</h3>

      {/* Privacy Level */}
      <div className="space-y-2">
        <Label htmlFor="privacyLevel">Visibilité</Label>
        <Select
          value={options.privacyLevel}
          onValueChange={handlePrivacyChange}
          disabled={disabled}
        >
          <SelectTrigger id="privacyLevel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PUBLIC">Public</SelectItem>
            <SelectItem value="SECRET">Secret</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Board Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="board">Tableau Pinterest</Label>
          <div className="flex gap-2">
            {!loading && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshBoards}
                disabled={loading || disabled}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Actualiser
              </Button>
            )}
            <Dialog
              open={showCustomBoardDialog}
              onOpenChange={setShowCustomBoardDialog}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter manuellement
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>
                    Ajouter un tableau Pinterest manuellement
                  </DialogTitle>
                  <DialogDescription>
                    <p className="mb-2">
                      Saisissez l&apos;ID et le nom de votre tableau Pinterest.
                    </p>
                    <p className="text-sm mb-2">
                      <strong>
                        Comment trouver l&apos;ID de votre tableau:
                      </strong>
                    </p>
                    <ol className="list-decimal pl-5 text-sm space-y-1">
                      <li>
                        Allez sur votre tableau Pinterest dans votre navigateur
                      </li>
                      <li>
                        L&apos;ID se trouve dans l&apos;URL sous forme numérique
                        (ex: 549755885175)
                      </li>
                      <li>
                        Ou utilisez le format: username/board-name (ex:
                        fiscalfresco/finance-tips)
                      </li>
                    </ol>
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="boardId" className="text-right">
                      ID du tableau
                    </Label>
                    <Input
                      id="boardId"
                      placeholder="Ex: 1114922588909590117"
                      value={customBoardId}
                      onChange={(e) => setCustomBoardId(e.target.value)}
                      className="col-span-3"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="boardName" className="text-right">
                      Nom du tableau
                    </Label>
                    <Input
                      id="boardName"
                      placeholder="Finance Tips"
                      value={customBoardName}
                      onChange={(e) => setCustomBoardName(e.target.value)}
                      className="col-span-3"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleAddCustomBoard}>
                    Ajouter le tableau
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <Select
              value={options.board}
              onValueChange={handleBoardChange}
              disabled={disabled || boards.length === 0}
            >
              <SelectTrigger id="board">
                <SelectValue placeholder="Sélectionner un tableau" />
              </SelectTrigger>
              <SelectContent>
                {boards.length === 0 ? (
                  <SelectItem value="no-boards-available" disabled>
                    Aucun tableau disponible
                  </SelectItem>
                ) : (
                  boards.map((board) => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            {boards.length === 0 && !loading && (
              <Alert className="mt-3">
                <InfoIcon className="h-4 w-4" />
                <AlertDescription>
                  <p className="mb-2">
                    Aucun tableau Pinterest trouvé. Vous pouvez:
                  </p>
                  <ul className="list-disc pl-5 mb-2 space-y-1">
                    <li>
                      <a
                        href="https://www.pinterest.fr/board/create/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center text-blue-500 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Créer un tableau sur Pinterest
                      </a>
                    </li>
                    <li>
                      Utiliser le bouton &quot;Ajouter manuellement&quot;
                      ci-dessus
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {error && <div className="mt-2 text-sm text-red-500">{error}</div>}
          </>
        )}
      </div>

      {/* Link URL */}
      <div className="space-y-2">
        <Label htmlFor="link">URL du lien</Label>
        <Input
          id="link"
          type="url"
          placeholder="https://example.com"
          value={options.link || ""}
          onChange={handleLinkChange}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Ajouter un lien rendra votre épingle cliquable
        </p>
      </div>

      {/* Debug information */}
      {debugInfo && (
        <div className="mt-3 p-3 bg-muted text-xs font-mono whitespace-pre-wrap rounded-md border">
          <p className="font-semibold mb-1">Informations de débogage:</p>
          {debugInfo}
        </div>
      )}
    </div>
  );
}

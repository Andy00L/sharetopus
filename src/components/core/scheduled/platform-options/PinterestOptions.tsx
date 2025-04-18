// components/core/scheduled/platform-options/PinterestOptions.tsx
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

// Define the Pinterest options type
export interface PinterestOptions {
  privacyLevel: string;
  board: string;
  link: string;
}

interface PinterestOptionsProps {
  readonly options: PinterestOptions;
  readonly onChange: (options: PinterestOptions) => void;
  readonly disabled?: boolean;
  readonly boards?: Array<{ id: string; name: string }>;
}

export function PinterestPostOptions({
  options,
  onChange,
  disabled = false,
  boards = [],
}: PinterestOptionsProps) {
  // Handler for privacy level change
  const handlePrivacyChange = (value: string) => {
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

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Pinterest Post Options</h3>

      {/* Privacy Level */}
      <div className="space-y-2">
        <Label htmlFor="privacyLevel">Visibility</Label>
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
            <SelectItem value="PROTECTED">Protected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Board Selection */}
      <div className="space-y-2">
        <Label htmlFor="board">Board</Label>
        <Select
          value={options.board}
          onValueChange={handleBoardChange}
          disabled={disabled || boards.length === 0}
        >
          <SelectTrigger id="board">
            <SelectValue placeholder="Select a board" />
          </SelectTrigger>
          <SelectContent>
            {boards.length === 0 ? (
              <SelectItem value="" disabled>
                No boards available
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
      </div>

      {/* Link URL */}
      <div className="space-y-2">
        <Label htmlFor="link">Link URL (Optional)</Label>
        <Input
          id="link"
          type="url"
          placeholder="https://example.com"
          value={options.link}
          onChange={handleLinkChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

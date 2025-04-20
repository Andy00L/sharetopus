// components/core/schedule/platform-options/TikTokOptions.tsx
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PrivacyLevel, TikTokOptions } from "@/lib/types/dbTypes";

interface TikTokOptionsProps {
  readonly options: TikTokOptions;
  readonly onChange: (options: TikTokOptions) => void;
  readonly disabled?: boolean;
}

export function TikTokPostOptions({
  options,
  onChange,
  disabled = false,
}: TikTokOptionsProps) {
  // Handler for privacy level change
  const handlePrivacyChange = (value: PrivacyLevel) => {
    onChange({
      ...options,
      privacyLevel: value,
    });
  };

  // Handler for toggle options
  const handleToggleChange = (
    optionName: "disableComment" | "disableDuet" | "disableStitch",
    checked: boolean
  ) => {
    onChange({
      ...options,
      [optionName]: checked,
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">TikTok Post Options</h3>

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
            <SelectItem value="PUBLIC_TO_EVERYONE">Public</SelectItem>
            <SelectItem value="MUTUAL_FOLLOW_FRIENDS">Friends</SelectItem>
            <SelectItem value="SELF_ONLY">Private (Me only)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="disableComment">Disable comments</Label>
          <Switch
            id="disableComment"
            checked={options.disableComment}
            onCheckedChange={(checked) =>
              handleToggleChange("disableComment", checked)
            }
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="disableDuet">Disable duets</Label>
          <Switch
            id="disableDuet"
            checked={options.disableDuet}
            onCheckedChange={(checked) =>
              handleToggleChange("disableDuet", checked)
            }
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="disableStitch">Disable stitches</Label>
          <Switch
            id="disableStitch"
            checked={options.disableStitch}
            onCheckedChange={(checked) =>
              handleToggleChange("disableStitch", checked)
            }
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

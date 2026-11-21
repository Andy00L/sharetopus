import type { PinterestBoard } from "@/lib/api/pinterest/data/getPinterestBoards";
import type { PinterestBoardDTO } from "@/lib/api/rest/openapi/responseSchemas";

export function toPinterestBoardDTO(
  board: PinterestBoard,
): PinterestBoardDTO {
  return {
    id: board.id,
    name: board.name,
    description: board.description ?? null,
    privacy: board.privacy ?? null,
    pin_count: board.pin_count ?? null,
  };
}

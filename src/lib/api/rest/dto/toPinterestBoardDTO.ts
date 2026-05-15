/**
 * Shape returned by getPinterestBoards. Defined here to decouple
 * the REST DTO from the internal Pinterest API client shape.
 */
interface PinterestBoardRow {
  id: string;
  name: string;
  description?: string;
  privacy?: string;
  pin_count?: number;
}

/**
 * Public DTO for a Pinterest board. Mirrors the internal shape
 * but is explicit so new fields from the Pinterest API do not
 * auto-leak into the REST contract.
 */
export type PinterestBoardDTO = {
  id: string;
  name: string;
  description: string | null;
  privacy: string | null;
  pin_count: number | null;
};

export function toPinterestBoardDTO(
  board: PinterestBoardRow,
): PinterestBoardDTO {
  return {
    id: board.id,
    name: board.name,
    description: board.description ?? null,
    privacy: board.privacy ?? null,
    pin_count: board.pin_count ?? null,
  };
}

import type { PinterestBoardDTO } from "@/lib/api/rest/openapi/responseSchemas";

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
 * Public DTO for a Pinterest board; its shape is PinterestBoardDTOSchema
 * (responseSchemas.ts), the same schema the OpenAPI spec renders. Explicit
 * so new fields from the Pinterest API do not auto-leak into the REST
 * contract.
 */
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

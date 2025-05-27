import { ContentHistory } from "@/lib/types/dbTypes";
import "server-only";

// Définir un type pour les éléments de média
interface MediaContent {
  status: string;
  description?: { text: string };
  media?: string;
  originalUrl?: string;
  title?: { text: string };
}
// Define return type to make it easier to work with in the server action
export interface LinkedInPostResult {
  success: boolean;
  postId?: string;
  data?: ContentHistory[];
  error?: string;
  details?: Record<string, unknown>; // More specific than any
  message?: string;
}
// Change to:
export async function postToLinkedIn({
  accessToken,
  memberUrn,
  text,
  title,
  link,
  mediaPath,
  mediaType,
  postType,
  buffer,
}: {
  accessToken: string;
  memberUrn: string;
  text: string;
  title?: string;
  link?: string;
  postType: "image" | "video" | "text";

  mediaPath: string;
  mediaType?: string;
  userId: string;
  fileName?: string;
  buffer?: Buffer;
  coverTimestamp?: number;
}) {
  try {
    // Vérification des paramètres requis
    if (!accessToken || !memberUrn) {
      console.log("[LinkedIn Post route] Missing required parameters");
      return {
        success: false,
        error:
          "Missing required parameters (accessToken, memberUrn, and text are required)",
      };
    }

    // Déterminer le type de publication
    let shareMediaCategory = "NONE"; // Par défaut, partage de texte
    let mediaContent: MediaContent[] = [];
    if (mediaPath) {
      // Recette et catégorie en fonction du type de média
      const mediaRecipe =
        postType === "image"
          ? "urn:li:digitalmediaRecipe:feedshare-image"
          : "urn:li:digitalmediaRecipe:feedshare-video";

      shareMediaCategory = postType === "image" ? "IMAGE" : "VIDEO";

      // Pour LinkedIn, nous devons d'abord uploader le média avant de l'utiliser dans un post
      console.log(`[LinkedIn Post Routes] Preparing to upload ${postType}`);

      // 1. Enregistrer le média pour l'upload
      try {
        const registerResponse = await fetch(
          "https://api.linkedin.com/v2/assets?action=registerUpload",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              "X-Restli-Protocol-Version": "2.0.0",
            },
            body: JSON.stringify({
              registerUploadRequest: {
                recipes: [mediaRecipe],
                owner: memberUrn,
                serviceRelationships: [
                  {
                    relationshipType: "OWNER",
                    identifier: "urn:li:userGeneratedContent",
                  },
                ],
              },
            }),
          }
        );

        if (!registerResponse.ok) {
          const errorText = await registerResponse.text();
          const errorDetails = JSON.parse(errorText);

          console.error(
            "[LinkedIn Post Routes] Failed to register media upload:",
            errorDetails
          );
          return {
            success: false,
            error: `Failed to register ${postType} upload with LinkedIn`,
            details: errorDetails,
          };
        }

        const registerData = await registerResponse.json();
        console.log(
          "[LinkedIn Post Routes] Register upload response:",
          registerData
        );

        // Extraire l'URL d'upload et l'URN de l'actif
        const uploadUrl =
          registerData.value.uploadMechanism[
            "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
          ].uploadUrl;
        const assetUrn = registerData.value.asset;

        console.log(
          `[LinkedIn Post Routes] Media registration successful, uploading ${postType} to:`,
          uploadUrl
        );

        // 2. Stream the file directly from Supabase to LinkedIn
        try {
          if (!buffer) {
            console.error(
              "[LinkedIn Post Routes] Error retrieving file from buffer:"
            );
            return {
              success: false,
              error: "Failed to retrieve media file from storage",
            };
          }
          if (!mediaType) {
            console.error(
              "[LinkedIn Post Routes] Missing media type for upload"
            );
            return {
              success: false,
              error: "Media type is required for media uploads",
            };
          }

          // 3. Uploader le média
          const uploadMethod = postType === "video" ? "POST" : "PUT"; // LinkedIn utilise généralement PUT pour les images et POST pour les vidéos
          const uploadResponse = await fetch(uploadUrl, {
            method: uploadMethod,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": mediaType,
            },
            body: buffer,
          });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            let errorDetails;
            try {
              errorDetails = JSON.parse(errorText);
            } catch (parseError) {
              errorDetails = { rawError: errorText };
              console.error(
                "[LinkedIn Post Routes] Error parsing upload response:",
                parseError
              );
            }

            console.error(
              `[LinkedIn Post Routes] Failed to upload ${postType}:`,
              errorDetails
            );
            return {
              success: false,
              error: `Failed to upload ${postType} to LinkedIn`,
              details: errorDetails,
            };
          }

          console.log(
            `[LinkedIn Post Routes] ${postType} uploaded successfully, creating share with media`
          );

          // 4. Créer le média content pour le partage
          mediaContent = [
            {
              status: "READY",
              description: {
                text: text,
              },
              media: assetUrn,
              title: title ? { text: title } : undefined,
            },
          ];
        } catch (streamError) {
          console.error(
            `[LinkedIn Post Routes] Error streaming file from Supabase:`,
            streamError
          );
          return {
            success: false,
            error: `Failed to stream media file for upload`,
          };
        }
      } catch (mediaError) {
        console.error(
          `[LinkedIn Post Routes] Error during ${postType} upload process:`,
          mediaError
        );
        return {
          success: false,
          error: `Error during media upload`,
        };
      }
    } else if (link) {
      // Publication avec lien
      console.log("[LinkedIn Post Routes] Creating link share");
      shareMediaCategory = "ARTICLE";
      mediaContent = [
        {
          status: "READY",
          description: {
            text: title ?? text,
          },
          originalUrl: link,
          title: title ? { text: title } : undefined,
        },
      ];
    } else {
      // Publication de texte uniquement
      console.log("[LinkedIn Post Routes] Creating text-only share");
    }

    // Construire le corps de la requête en fonction du type de partage
    const requestBody = {
      author: memberUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: {
            text: text,
          },
          shareMediaCategory: shareMediaCategory,
          media: mediaContent.length > 0 ? mediaContent : undefined,
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    console.log("[LinkedIn Post Routes] Sending post request to LinkedIn API");

    // Appel à l'API LinkedIn pour créer la publication
    try {
      const linkedInResponse = await fetch(
        "https://api.linkedin.com/v2/ugcPosts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "X-Restli-Protocol-Version": "2.0.0",
          },
          body: JSON.stringify(requestBody),
        }
      );

      console.log(
        "[LinkedIn Post route] LinkedIn response status:",
        linkedInResponse.status
      );

      if (!linkedInResponse.ok) {
        const errorText = await linkedInResponse.text();
        let errorDetails;
        try {
          errorDetails = JSON.parse(errorText);
        } catch (parseError) {
          errorDetails = { rawError: errorText };
          console.error(
            "[LinkedIn Post Routes] Error parsing API response:",
            parseError
          );
        }

        console.error(
          "[LinkedIn Post Routes] LinkedIn API error:",
          errorDetails
        );
        return {
          success: false,
          error: "Failed to post to LinkedIn",
          details: errorDetails,
        };
      }

      // Récupérer la réponse
      const responseText = await linkedInResponse.text();
      let data;

      try {
        // La réponse peut être vide, donc nous vérifions
        data = responseText ? JSON.parse(responseText) : {};
        console.log("Raw response:", responseText);
      } catch (parseError) {
        console.log(
          `[LinkedIn Post Routes] Response is not JSON:${parseError}`,
          responseText
        );
        // Si ce n'est pas du JSON, nous utilisons la réponse brute
        data = { rawResponse: responseText };
      }

      // Récupérer l'ID du post depuis les headers
      const postId =
        linkedInResponse.headers.get("x-restli-id") ||
        (data && data.id) ||
        "unknown-post-id";

      console.log("[LinkedIn Post Routes] Successfully posted to LinkedIn");

      // Retourner une réponse de succès
      return {
        success: true,
        postId: postId,
        data: data,
        message: `Successfully created ${
          shareMediaCategory === "NONE"
            ? "text"
            : shareMediaCategory === "ARTICLE"
            ? "link"
            : shareMediaCategory === "VIDEO"
            ? "video"
            : "image"
        } post on LinkedIn`,
      };
    } catch (postError) {
      console.error(
        "[LinkedIn Post Routes] Error posting to LinkedIn:",
        postError
      );
      return {
        success: false,
        error: `Error posting to LinkedIn: ${
          postError instanceof Error ? postError.message : String(postError)
        }`,
      };
    }
  } catch (error) {
    console.error("[LinkedIn Post Routes] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post to LinkedIn",
      message: "Unexpected error",
    };
  }
}

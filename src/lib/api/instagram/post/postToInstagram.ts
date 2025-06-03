import { ContentHistory } from "@/lib/types/dbTypes";
import "server-only";

// Define proper types for Instagram API parameters
interface InstagramMediaParams {
  image_url?: string;
  video_url?: string;
  thumb_offset?: number;
  caption?: string;
  alt_text?: string;
  media_type?: "REELS" | "STORIES" | "VIDEO" | "CAROUSEL";
  is_carousel_item?: boolean;
  share_to_feed?: boolean;
  children?: string; // For carousel containers
}

// Define return type to make it easier to work with in the server action
export interface InstagramPostResult {
  success: boolean;
  postId?: string;
  containerId?: string;
  data?: ContentHistory[];
  error?: string;
  details?: Record<string, unknown>;
  message?: string;
}

export async function postToInstagram({
  accessToken,
  userId,
  caption,

  coverTimestamp,
  mediaUrl,
  postType,
  isCarousel = false,
  carouselItems = [],
  altText, // Add this
  shareToFeed,
}: {
  accessToken: string;
  userId: string; // Instagram User ID (user_id from profile)
  caption?: string;
  postType: "image" | "reel" | "carousel";

  mediaUrl?: string; // PUBLIC URL - Instagram will cURL this
  isCarousel?: boolean;
  mediaType: string;
  fileName: string;
  coverTimestamp?: number;
  altText: string; // Add this
  shareToFeed?: boolean; // Add this
  carouselItems?: Array<{
    mediaUrl: string;
    mediaType: "image" | "video";
    altText?: string;
  }>;
}): Promise<InstagramPostResult> {
  try {
    // Vérification des paramètres requis selon la doc
    if (!accessToken || !userId) {
      console.log("[Instagram Post] Missing required parameters");
      return {
        success: false,
        error:
          "Missing required parameters (accessToken and userId are required)",
      };
    }

    const baseUrl = "https://graph.instagram.com/v23.0";

    // Gestion des différents types de posts selon la doc
    if (isCarousel && carouselItems.length > 0) {
      return await createCarouselPost({
        accessToken,
        userId,
        caption,
        carouselItems,
        baseUrl,
      });
    } else if (mediaUrl) {
      return await createSingleMediaPost({
        accessToken,
        userId,
        caption,
        mediaUrl,
        postType,
        coverTimestamp,
        baseUrl,
        shareToFeed,
        altText,
      });
    } else {
      return {
        success: false,
        error:
          "Instagram requires media content. Please provide a public mediaUrl.",
      };
    }
  } catch (error) {
    console.error("[Instagram Post] Unexpected error:", error);
    return {
      success: false,
      error: "Failed to post to Instagram",
      message: "Unexpected error",
    };
  }
}

// Fonction pour créer un post avec un seul média - SELON LA DOC
async function createSingleMediaPost({
  accessToken,
  userId,
  caption,
  mediaUrl,
  postType,
  baseUrl,
  altText,
  shareToFeed,
  coverTimestamp,
}: {
  accessToken: string;
  userId: string;
  caption?: string;
  mediaUrl: string;
  postType: string;
  baseUrl: string;
  altText: string;
  coverTimestamp?: number;

  shareToFeed?: boolean;
}): Promise<InstagramPostResult> {
  try {
    console.log(`[Instagram Post] Creating ${postType} post`);

    // Étape 1: Créer un container média selon la doc
    const containerResult = await createMediaContainer({
      accessToken,
      userId,
      caption,
      mediaUrl,
      postType,
      baseUrl,
      altText,
      shareToFeed,
      coverTimestamp,
    });

    if (!containerResult.success || !containerResult.containerId) {
      return containerResult;
    }

    // Vérifier le statut du container avant publication (recommandé par la doc)
    const statusCheck = await checkContainerStatus({
      accessToken,
      containerId: containerResult.containerId,
    });

    if (statusCheck.success && statusCheck.status !== "FINISHED") {
      console.log(
        `[Instagram Post] Container status: ${statusCheck.status}, waiting...`
      );

      // Attendre que le container soit prêt ( max  8 seconde, 1 fois par minute)
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 8000)); // 8 seconde
        attempts++;

        const newStatus = await checkContainerStatus({
          accessToken,
          containerId: containerResult.containerId,
        });

        if (newStatus.success && newStatus.status === "FINISHED") {
          break;
        }

        if (
          newStatus.success &&
          (newStatus.status === "ERROR" || newStatus.status === "EXPIRED")
        ) {
          return {
            success: false,
            error: `Container failed with status: ${newStatus.status}`,
          };
        }
      }
    }

    // Étape 2: Publier le container
    return await publishContainer({
      accessToken,
      userId,
      containerId: containerResult.containerId,
      baseUrl,
      postType,
    });
  } catch (error) {
    console.error("[Instagram Post] Error in single media post:", error);
    return {
      success: false,
      error: `Error creating ${postType} post`,
    };
  }
}

// Fonction pour créer un container média - STRICTEMENT SELON LA DOC
async function createMediaContainer({
  accessToken,
  userId,
  caption,
  mediaUrl,
  postType,
  baseUrl,
  isCarouselItem = false,
  altText,
  shareToFeed,
  coverTimestamp,
}: {
  accessToken: string;
  userId: string;
  caption?: string;
  mediaUrl: string;
  postType: string;
  baseUrl: string;
  altText: string;
  coverTimestamp?: number;
  shareToFeed?: boolean;

  isCarouselItem?: boolean;
}): Promise<InstagramPostResult> {
  try {
    // Déterminer les paramètres selon la doc Instagram
    const isVideo = postType === "reel";

    // Construction des paramètres EXACTEMENT comme dans la doc
    const containerParams: InstagramMediaParams = {};

    // Paramètre média selon la doc
    if (isVideo) {
      containerParams.video_url = mediaUrl;
    } else {
      containerParams.image_url = mediaUrl;
    }

    // Caption seulement si ce n'est pas un item de carousel
    if (!isCarouselItem && caption) {
      containerParams.caption = caption;
    }

    // Alt text for images only (new feature as of March 24, 2025)
    if (!isVideo && altText && !isCarouselItem) {
      containerParams.alt_text = altText;
    }

    // Media type selon la doc
    if (postType === "reel") {
      containerParams.media_type = "REELS";
    }
    // Pour les images, pas de media_type selon la doc

    // Carousel item flag selon la doc
    if (isCarouselItem) {
      containerParams.is_carousel_item = true;
    }

    console.log(
      "[Instagram Post] Creating media container with params:",
      containerParams
    );

    // Reels-specific parameters
    if (postType === "reel") {
      if (shareToFeed !== undefined) {
        containerParams.share_to_feed = shareToFeed;
      }
    }

    // Video/Reel thumbnail offset
    if (isVideo && coverTimestamp !== undefined) {
      containerParams.thumb_offset = coverTimestamp;
    }
    // Appel API EXACTEMENT comme dans la doc
    const containerResponse = await fetch(`${baseUrl}/${userId}/media`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(containerParams),
    });

    if (!containerResponse.ok) {
      const errorText = await containerResponse.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = { rawError: errorText };
      }

      console.error(
        "[Instagram Post] Failed to create media container:",
        errorDetails
      );
      return {
        success: false,
        error: `Failed to create media container`,
        details: errorDetails,
      };
    }

    const containerData = await containerResponse.json();
    console.log("[Instagram Post] Media container created:", containerData);

    return {
      success: true,
      containerId: containerData.id,
      message: "Media container created successfully",
    };
  } catch (error) {
    console.error("[Instagram Post] Error creating media container:", error);
    return {
      success: false,
      error: "Error creating media container",
    };
  }
}

// Fonction pour créer un post carousel - SELON LA DOC
async function createCarouselPost({
  accessToken,
  userId,
  caption,
  carouselItems,
  baseUrl,
}: {
  accessToken: string;
  userId: string;
  caption?: string;
  carouselItems: Array<{
    mediaUrl: string;
    mediaType: "image" | "video";
  }>;
  baseUrl: string;
}): Promise<InstagramPostResult> {
  try {
    console.log(
      `[Instagram Post] Creating carousel with ${carouselItems.length} items`
    );

    // Validation selon la doc
    if (carouselItems.length > 10) {
      return {
        success: false,
        error: "Carousel is limited to 10 items maximum",
      };
    }

    if (carouselItems.length === 0) {
      return {
        success: false,
        error: "Carousel requires at least one item",
      };
    }

    // Étape 1: Créer des containers pour chaque item du carousel
    const containerIds: string[] = [];

    for (let i = 0; i < carouselItems.length; i++) {
      const item = carouselItems[i];
      console.log(
        `[Instagram Post] Creating container for carousel item ${i + 1}`
      );

      const containerResult = await createMediaContainer({
        accessToken,
        userId,
        mediaUrl: item.mediaUrl,
        postType: item.mediaType === "video" ? "video" : "image",
        baseUrl,
        altText: "",
        isCarouselItem: true,
      });

      if (!containerResult.success || !containerResult.containerId) {
        return {
          success: false,
          error: `Failed to create container for carousel item ${i + 1}`,
          details: containerResult.details,
        };
      }

      containerIds.push(containerResult.containerId);
    }

    // Étape 2: Créer le container carousel EXACTEMENT selon la doc
    console.log("[Instagram Post] Creating carousel container");

    const carouselParams = {
      media_type: "CAROUSEL",
      children: containerIds.join(","),
      ...(caption && { caption }), // Comma separated list selon la doc
    };

    const carouselResponse = await fetch(`${baseUrl}/${userId}/media`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(carouselParams),
    });

    if (!carouselResponse.ok) {
      const errorText = await carouselResponse.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = { rawError: errorText };
      }

      console.error(
        "[Instagram Post] Failed to create carousel container:",
        errorDetails
      );
      return {
        success: false,
        error: "Failed to create carousel container",
        details: errorDetails,
      };
    }

    const carouselData = await carouselResponse.json();
    console.log("[Instagram Post] Carousel container created:", carouselData);

    // Étape 3: Publier le carousel
    return await publishContainer({
      accessToken,
      userId,
      containerId: carouselData.id,
      baseUrl,
      postType: "carousel",
    });
  } catch (error) {
    console.error("[Instagram Post] Error creating carousel post:", error);
    return {
      success: false,
      error: "Error creating carousel post",
    };
  }
}

// Fonction pour publier un container - EXACTEMENT selon la doc
async function publishContainer({
  accessToken,
  userId,
  containerId,
  baseUrl,
  postType,
}: {
  accessToken: string;
  userId: string;
  containerId: string;
  baseUrl: string;
  postType: string;
}): Promise<InstagramPostResult> {
  try {
    console.log(
      `[Instagram Post] Publishing ${postType} container:`,
      containerId
    );

    // Appel EXACTEMENT comme dans la doc
    const publishResponse = await fetch(`${baseUrl}/${userId}/media_publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        creation_id: containerId, // Selon la doc
      }),
    });

    if (!publishResponse.ok) {
      const errorText = await publishResponse.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = { rawError: errorText };
      }

      console.error(
        "[Instagram Post] Failed to publish container:",
        errorDetails
      );
      return {
        success: false,
        error: "Failed to publish content to Instagram",
        details: errorDetails,
      };
    }

    const publishData = await publishResponse.json();
    console.log(
      "[Instagram Post] Successfully published to Instagram:",
      publishData
    );

    return {
      success: true,
      postId: publishData.id, // Instagram Media ID selon la doc
      containerId: containerId,
      data: publishData,
      message: `Successfully created ${postType} post on Instagram`,
    };
  } catch (error) {
    console.error("[Instagram Post] Error publishing container:", error);
    return {
      success: false,
      error: "Error publishing content to Instagram",
    };
  }
}

// Fonction utilitaire pour vérifier le statut d'un container - SELON LA DOC
export async function checkContainerStatus({
  accessToken,
  containerId,
}: {
  accessToken: string;
  containerId: string;
}): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  try {
    // Endpoint EXACTEMENT selon la doc
    const response = await fetch(
      `https://graph.instagram.com/v23.0/${containerId}?fields=status_code&access_token=${accessToken}`
    );

    if (!response.ok) {
      return {
        success: false,
        error: "Failed to check container status",
      };
    }

    const data = await response.json();

    // Status codes selon la doc:
    // EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED
    return {
      success: true,
      status: data.status_code,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Error checking container status",
    };
  }
}

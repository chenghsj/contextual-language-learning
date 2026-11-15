import {
  FAVORITE_MAX_BYTES,
  type HostMessage,
  type HostRequest,
  type FavoritesService,
} from "@contextual/core";

export function createFavoriteHandler(
  service: FavoritesService,
  reply: (message: HostMessage) => void,
) {
  return async (request: HostRequest): Promise<boolean> => {
    switch (request.type) {
      case "favoriteStates":
        reply({
          id: request.id,
          type: "favoriteStates",
          collection: request.collection,
          states: await service.states(request.collection, request.documentId, request.sceneIds),
        });
        return true;
      case "setFavorite":
        reply({
          id: request.id,
          type: "favoriteChanged",
          collection: request.input.collection,
          favorite: await service.set(request.input),
        });
        return true;
      case "listFavorites":
        reply({
          id: request.id,
          type: "favorites",
          collection: request.collection,
          page: await service.list(request.collection, request.query),
        });
        return true;
      case "favoriteStatus":
        reply({
          id: request.id,
          type: "favoriteStatus",
          status: await service.status(request.collection),
        });
        return true;
      case "configureFavorites":
        reply({
          id: request.id,
          type: "favoriteStatus",
          status: await service.configure(request.change),
        });
        return true;
      case "syncFavorites":
        reply({
          id: request.id,
          type: "favoriteStatus",
          status: await service.sync(request.collection),
        });
        return true;
      case "getFavorite": {
        const snapshot = await service.get(request.collection, request.key);
        const bytes = Buffer.from(JSON.stringify(snapshot));
        if (bytes.length > FAVORITE_MAX_BYTES) throw new Error("Favorite exceeds the 20 MB limit");
        if (bytes.length < 500000)
          reply({
            id: request.id,
            type: "favorite",
            collection: request.collection,
            key: request.key,
            snapshot,
          });
        else {
          const size = 256 * 1024,
            total = Math.ceil(bytes.length / size);
          for (let index = 0; index < total; index++)
            reply({
              id: request.id,
              type: "favoriteChunk",
              collection: request.collection,
              key: request.key,
              index,
              total,
              dataBase64: bytes.subarray(index * size, (index + 1) * size).toString("base64"),
            });
        }
        return true;
      }
      default:
        return false;
    }
  };
}

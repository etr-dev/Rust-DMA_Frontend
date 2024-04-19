/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useWebSocket } from "../test/websocket";
import {
  Category,
  ISceneItem,
  ISceneItems,
} from "./interfaces/radar/sceneItem.interface";
import { Item } from "./interfaces/game/items/item.type";
import { AddItem } from "./interfaces/radar/addItem.interface";
import { loadTextures, preloadedTextures } from "./helpers/textures";
import { addText, alignText } from "./helpers/text";
import { convertGamePositionToMap, map, setupMap } from "./helpers/map";
import { Settings } from "./interfaces/radar/settings.interface";
import { LootContainer } from "./interfaces/game/items/lootContainer.interface";
import { LootContainerType } from "./interfaces/game/items/lootContainers.type";
import { IRustRadarData } from "./interfaces/game/rustRadarData.interface";

const defaultSceneItems: ISceneItems = {
  players: {},
  loot: {},
  nodes: {},
};

const zeroVector = new THREE.Vector3(0, 0, 0);

let count = 1;

const Radar: React.FC<{
  settings: Settings;
}> = (props) => {
  // References
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Variables
  const [previousSettings, setPreviousSettings] = useState<Settings | null>(
    null
  );
  const [targetCameraPosition, setTargetCameraPosition] = useState<
    THREE.Vector3 | undefined
  >(undefined);
  const [sceneItems, setSceneItems] = useState<ISceneItems>(defaultSceneItems);

  // Websocket/Data
  const { data } = useWebSocket();
  const { settings } = props;

  /*
   ************************************
   *                                  *
   *                                  *
   *       HELPER FUNCTIONS           *
   *                                  *
   *                                  *
   ************************************
   */
  const calculateCameraZoomScale = (): number => {
    return 5 / (cameraRef.current?.zoom ?? 1);
  };

  const addItemRevised = async (input: AddItem): Promise<ISceneItem> => {
    const enum ItemTypes {
      TEXT = "TEXT",
      SPRITE = "SPRITE",
    }

    const { category, zoomFactor } = input;
    const position = convertGamePositionToMap(input.position);

    const spriteId = `${ItemTypes.SPRITE}_${input.identifier}`;
    const existingSprite = input.scene.getObjectByName(spriteId);

    const textId = `${ItemTypes.TEXT}_${input.identifier}`;
    const existingText = input.scene.getObjectByName(textId);

    let sprite: THREE.Sprite = existingSprite as THREE.Sprite;
    let text = existingText;

    // No sprite exists yet
    if (!existingSprite) {
      const spriteMaterial = new THREE.SpriteMaterial({ map: input.texture });
      sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(position.x, position.y, position.z);
      const scale = input.scale.clone().multiplyScalar(zoomFactor ?? 1);
      sprite.scale.set(scale.x, scale.y, input.scale.z);
      sprite.name = spriteId;
      input.scene.add(sprite);
    }

    // No text label exists yet and should be created
    if (!existingText && input.label) {
      text = await addText({
        textId,
        textString: input.label.text,
        color: input.label.color,
        parameters: {
          size: input.label.size,
        },
      });
      input.scene.add(text as THREE.Mesh);
    }

    // Set the sprite's position
    if (sprite) {
      const layerPosition = input.layerPosition ?? 0.1;
      sprite.position.set(position.x, position.y, layerPosition);
    }

    // Set the position of the text
    if (text) {
      const textPosition = position;
      textPosition.setZ(input.layerPosition ?? 0.1);
      textPosition.setY(position.y - (input.label?.offset ?? 10));
      alignText(text as THREE.Mesh, textPosition);
    }

    return { text: text as THREE.Mesh, sprite, originalScale: input.scale };
  };

  const refreshAll = (scene: THREE.Scene): void => {
    console.log("REFRESHING ALL");
    setSceneItems({ ...defaultSceneItems });

    scene.clear();
  };

  const removeSceneItemsById = (
    scene: THREE.Scene,
    identifiers: string[],
    category: Category
  ): void => {
    console.log("removing", identifiers);
    const sceneItemsCopy = JSON.parse(JSON.stringify(sceneItems)); // Deep copy

    for (const id of identifiers) {
      const item = sceneItemsCopy[category][id];
      if (!item) continue;
      console.log(item);

      const { text, dot, sprite } = item;
      if (dot) scene.remove(dot as THREE.Mesh);
      if (text) scene.remove(text as THREE.Mesh);
      if (sprite) scene.remove(sprite as THREE.Sprite);

      delete sceneItemsCopy[category][id];
    }

    setSceneItems(sceneItemsCopy);
  };

  /*
   ************************************
   *                                  *
   *                                  *
   *          USE EFFECTS             *
   *                                  *
   *                                  *
   ************************************
   */

  // Initialize Three.js scene, camera, and renderer
  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      window.innerWidth / -2,
      window.innerWidth / 2,
      window.innerHeight / 2,
      window.innerHeight / -2,
      1,
      1000
    );
    camera.position.z = 1000;

    const renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    loadTextures();
    setupMap(scene);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    const render = () => {
      requestAnimationFrame(render);
      renderer.render(scene, camera);
    };

    render();

    // Handle window resize
    const handleResize = () => {
      refreshAll(scene);
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Update camera properties
      camera.left = width / -2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = height / -2;
      camera.updateProjectionMatrix();

      // Update renderer size
      renderer.setSize(width, height);

      // If you are using an image, update its scale or position here as needed
      setupMap(scene);
      scene.remove(map);
    };

    window.addEventListener("resize", handleResize);

    // Wheel event for zooming
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const zoomFactor = 0.01; // Adjust this factor to control zoom sensitivity
      const minZoom = 1; // Minimum zoom level, representing the "normal size"
      const maxZoom = 10; // Maximum zoom level, adjust as needed

      // Calculate new zoom level
      let newZoom = camera.zoom + event.deltaY * -zoomFactor;

      // Clamp the new zoom level between minZoom and maxZoom
      newZoom = Math.max(Math.min(newZoom, maxZoom), minZoom);

      // Apply the new zoom level
      camera.zoom = newZoom;
      camera.updateProjectionMatrix();
      const spriteScale = calculateCameraZoomScale();
      Object.values(sceneItems).forEach(
        (category: { [key: string]: ISceneItem }) => {
          Object.values(category).forEach((item: ISceneItem) => {
            if (item.sprite && item.originalScale) {
              const newScale = item.originalScale
                .clone()
                .multiplyScalar(spriteScale);
              item.sprite.scale.set(newScale.x, newScale.y, 1);
            }
          });
        }
      );
    };

    renderer.domElement.addEventListener("wheel", onWheel);

    return () => {
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const addOrUpdateNodes = (
      nodeData: IRustRadarData["nodes"] | undefined
    ): void => {
      if (!scene || !nodeData) return;

      // removeSceneItemsById(scene, Object.keys(sceneItems.nodes), "nodes");

      const sulfur: Item[] = nodeData.sulfur ?? [];
      if (settings.sulfur)
        sulfur.forEach((node) => {
          addItemRevised({
            scene,
            identifier: node.id,
            position: new THREE.Vector3(
              node.position.x,
              node.position.y,
              node.position.z
            ),
            texture: preloadedTextures.sulfur as THREE.Texture,
            scale: new THREE.Vector3(1, 1, 1),
            zoomFactor: calculateCameraZoomScale(),
            category: "nodes",
          });
        });

      const metal: Item[] = nodeData.metal ?? [];
      if (settings.metal)
        metal.forEach((node) => {
          addItemRevised({
            scene,
            identifier: node.id,
            position: new THREE.Vector3(
              node.position.x,
              node.position.y,
              node.position.z
            ),
            texture: preloadedTextures.metal as THREE.Texture,
            scale: new THREE.Vector3(1, 1, 1),
            zoomFactor: calculateCameraZoomScale(),
            category: "nodes",
          });
        });

      const stone: Item[] = nodeData.stone ?? [];
      if (settings.stones)
        stone.forEach((node) => {
          addItemRevised({
            scene,
            identifier: node.id,
            position: new THREE.Vector3(
              node.position.x,
              node.position.y,
              node.position.z
            ),
            texture: preloadedTextures.stone as THREE.Texture,
            scale: new THREE.Vector3(1, 1, 1),
            zoomFactor: calculateCameraZoomScale(),
            category: "nodes",
          });
        });
    };

    const addOrUpdateLoot = (
      lootData: IRustRadarData["loot"] | undefined
    ): void => {
      if (!scene || !lootData) return;

      const displayCrate = (key: LootContainerType) => {
        if (settings[key] === undefined) {
          // console.log(`Key not found in settings - (${key})`);
          return;
        }

        if (preloadedTextures[key] === undefined) {
          console.log(`Key not found in preloadedTextures - (${key})`);
          return;
        }

        const crate: LootContainer[] = lootData[key] ?? [];
        if (settings[key])
          crate.forEach((node) => {
            addItemRevised({
              scene,
              identifier: node.id,
              position: new THREE.Vector3(
                node.position.x,
                node.position.y,
                node.position.z
              ),
              texture: preloadedTextures[key] as THREE.Texture,
              scale: new THREE.Vector3(6, 6, 1),
              zoomFactor: calculateCameraZoomScale(),
              category: "loot",
            });
          });
      };

      Object.keys(lootData).forEach((key) =>
        displayCrate(key as LootContainerType)
      );
    };

    const addOrUpdatePlayers = async (
      playerData: IRustRadarData["players"] | undefined
    ): Promise<void> => {
      if (!scene || !playerData) return;

      for (const player of playerData) {
        const playerPosition = new THREE.Vector3(
          player.position.x,
          player.position.y,
          player.position.z
        );

        if (!player.name || player.name === "") {
          return;
        }

        const item = await addItemRevised({
          scene,
          identifier: player.id,
          label: {
            text: player.name,
            color: "#00FF00",
            size: 2,
            offset: 2,
          },
          position: playerPosition,
          texture: preloadedTextures.localPlayer as THREE.Texture,
          scale: new THREE.Vector3(.5, .5, .5),
          zoomFactor: calculateCameraZoomScale(),
          layerPosition: 1,
          category: "players",
        });

        if (player.name.startsWith("love")) {
          setTargetCameraPosition(item.sprite?.clone().position);
        }
      }
    };

    const scene = sceneRef.current;

    addOrUpdateNodes(data?.nodes);
    addOrUpdatePlayers(data?.players);
    // addOrUpdateLoot(data?.loot);
  }, [data]);

  /*
    If an option is disabled in settings then
    we should clear all of the remaining blips
    on the map of where it was previously drawn.
  */
  useEffect(() => {
    const getKeysChangedFromTrueToFalse = (
      previousObject: Settings | null,
      currentObject: Settings
    ): string[] => {
      // If it is the first time
      if (!previousObject) return [];
      const changedKeys: string[] = [];

      // Iterate through keys in the previous object
      for (const key in previousObject) {
        // Check if the key exists in the current object and the value changed from true to false
        if (
          currentObject[key] !== undefined &&
          previousObject[key] === true &&
          currentObject[key] === false
        ) {
          changedKeys.push(key);
        }
      }

      return changedKeys;
    };

    // Keys switch to false
    const keysToRemove = getKeysChangedFromTrueToFalse(
      previousSettings,
      settings
    );

    // Set the settings so can compare next time they are updated
    setPreviousSettings(settings);

    if (keysToRemove.length < 1) return;

    // Remove the keys set to false so that they are no longer in the scene
    const scene = sceneRef.current;
    if (!scene) return;
    let keys;
    keysToRemove.map((key) => {
      console.log("Settings changed, removing", key);
      switch (key) {
        case "sulfur":
        case "stones":
        case "metal":
          // keys = Object.keys(sceneItems.nodes).length
          //   ? Object.keys(sceneItems.nodes[key])
          //   : undefined;
          // if (keys) removeSceneItemsById(scene, keys, "nodes");
          console.log("TODO: Remove from scene.");
          break;
        case "crate_normal_2":
        case "crate_normal_2_food":
        case "crate_normal_2_medical":
        case "crate_normal":
        case "crate_elite":
        case "bradley_crate":
        case "heli_crate":
        case "crate_basic":
        case "crate_tools":
        case "supply_drop":
        case "loot_barrel_1":
        case "loot_barrel_2":
        case "oil_barrel":
          // keys = Object.keys(sceneItems.loot).length
          //   ? Object.keys(sceneItems.loot[key])
          //   : undefined;
          // if (keys) removeSceneItemsById(scene, keys, "loot");
          console.log("TODO: Remove from scene.");
          break;
        default:
          console.log("unknown setting change:", key);
      }

      console.log("Updated Settings");
    });
  }, [settings]);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;

    camera.position.setX(targetCameraPosition?.x ?? 0);
    camera.position.setY(targetCameraPosition?.y ?? 0);
  }, [targetCameraPosition]);
  return <div ref={mountRef} />;
};

export default Radar;
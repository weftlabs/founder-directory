"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapInstance,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DiscoveryFounder, MapPlace } from "@/lib/discovery";
import { mapBounds } from "@/lib/discovery";
import { safeHttpUrl } from "@/lib/model";

function collection(founders: DiscoveryFounder[], places?: MapPlace[]) {
  const points = places
    ? places.map((p) => ({
        coordinates: p.coordinates,
        handle: "",
        name: "",
        city: p.city,
        country: p.country,
        count: p.count,
      }))
    : founders
        .filter((f) => f.coordinates)
        .map((f) => ({
          coordinates: f.coordinates!,
          handle: f.handle,
          name: f.name,
          city: f.city ?? "",
          country: f.country ?? "",
          count: 1,
        }));
  return {
    type: "FeatureCollection" as const,
    features: points.map(({ coordinates, ...properties }) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates },
      properties: {
        ...properties,
        pointKey: coordinates.map((value) => value.toFixed(5)).join(","),
      },
    })),
  };
}
export default function FounderMap({
  founders,
  selected,
  onSelect,
  onSelectGroup,
  places,
  onSelectPlace,
  onViewportChange,
  initialBounds,
}: {
  founders: DiscoveryFounder[];
  places?: MapPlace[];
  onSelectPlace?: (city: string, country: string) => void;
  onViewportChange?: (bounds: string) => void;
  initialBounds?: string;
  selected: DiscoveryFounder | null;
  onSelect: (handle: string) => void;
  onSelectGroup: (handles: string[]) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapInstance | null>(null);
  const data = useRef(collection(founders, places));
  const selectPlace = useRef(onSelectPlace);
  const select = useRef(onSelect);
  const selectGroup = useRef(onSelectGroup);
  const viewportChange = useRef(onViewportChange);
  const startingBounds = useRef(mapBounds(initialBounds));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    data.current = collection(founders, places);
    selectPlace.current = onSelectPlace;
    select.current = onSelect;
    selectGroup.current = onSelectGroup;
    viewportChange.current = onViewportChange;
  }, [
    founders,
    places,
    onSelect,
    onSelectGroup,
    onSelectPlace,
    onViewportChange,
  ]);
  useEffect(() => {
    if (!container.current) return;
    let map: MapInstance;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: "https://tiles.openfreemap.org/styles/dark",
        center: [12, 28],
        zoom: 1.4,
        minZoom: 0.8,
        maxZoom: 14,
        attributionControl: { compact: true },
      });
      instance.current = map;
      if (startingBounds.current) {
        const [west, south, east, north] = startingBounds.current;
        map.fitBounds(
          [
            [west, south],
            [east < west ? east + 360 : east, north],
          ],
          { duration: 0, padding: 0 },
        );
      }
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.on("error", () => setFailed(true));
    let viewportTimer: ReturnType<typeof setTimeout>;
    map.on("moveend", () => {
      clearTimeout(viewportTimer);
      viewportTimer = setTimeout(() => {
        const bounds = map.getBounds();
        const wrap = (value: number) =>
          ((((value + 180) % 360) + 360) % 360) - 180;
        const wholeWorld = bounds.getEast() - bounds.getWest() >= 360;
        viewportChange.current?.(
          map.getZoom() < 3
            ? ""
            : [
                wholeWorld ? -180 : wrap(bounds.getWest()),
                Math.max(-90, bounds.getSouth()),
                wholeWorld ? 180 : wrap(bounds.getEast()),
                Math.min(90, bounds.getNorth()),
              ]
                .map((value) => value.toFixed(3))
                .join(","),
        );
      }, 250);
    });
    map.on("load", () => {
      setFailed(false);
      map.addSource("founders", {
        type: "geojson",
        data: data.current,
        cluster: true,
        clusterProperties: { founderCount: ["+", ["get", "count"]] },
        clusterRadius: 54,
        clusterMaxZoom: 12,
      });
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "founders",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#d8ff3e",
          "circle-radius": [
            "step",
            ["get", "point_count"],
            20,
            10,
            25,
            100,
            32,
          ],
          "circle-stroke-width": 7,
          "circle-stroke-color": "rgba(216,255,62,0.14)",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "founders",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "founderCount"],
          "text-size": 13,
        },
        paint: { "text-color": "#15180b" },
      });
      map.addLayer({
        id: "founder-pins",
        type: "circle",
        source: "founders",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#d8ff3e",
          "circle-radius": 7,
          "circle-stroke-width": 5,
          "circle-stroke-color": "rgba(216,255,62,0.18)",
        },
      });
      map.on("click", "clusters", async (e) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const source = map.getSource("founders") as GeoJSONSource;
        try {
          const leaves = await source.getClusterLeaves(
            feature.properties.cluster_id,
            10000,
            0,
          );
          const locations = new Set(
            leaves.map((f) =>
              f.geometry.type === "Point"
                ? f.geometry.coordinates.join(",")
                : "",
            ),
          );
          if (
            locations.size === 1 ||
            (!selectPlace.current && map.getZoom() >= 12)
          ) {
            if (leaves[0]?.properties?.handle === "" && selectPlace.current) {
              selectPlace.current(
                String(leaves[0].properties.city),
                String(leaves[0].properties.country),
              );
              return;
            }
            selectGroup.current(
              leaves.map((f) => String(f.properties?.handle)),
            );
            return;
          }
          const zoom = await source.getClusterExpansionZoom(
            feature.properties.cluster_id,
          );
          map.easeTo({
            center: feature.geometry.coordinates as [number, number],
            zoom,
          });
        } catch {
          /* Map may have unmounted. */
        }
      });
      map.on("click", "founder-pins", (e) => {
        const place = e.features?.[0]?.properties;
        if (place?.handle === "" && selectPlace.current) {
          selectPlace.current(String(place.city), String(place.country));
          return;
        }
        const handles = [
          ...new Set(
            (e.features ?? []).map((f) => String(f.properties.handle)),
          ),
        ];
        if (handles.length > 1) selectGroup.current(handles);
        else if (handles[0]) select.current(handles[0]);
      });
      for (const layer of ["clusters", "founder-pins"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });
    return () => {
      clearTimeout(viewportTimer);
      instance.current = null;
      map.remove();
    };
  }, []);
  useEffect(() => {
    const map = instance.current;
    if (!map) return;
    const groups = new Map<string, DiscoveryFounder[]>();
    for (const founder of founders) {
      if (!founder.coordinates) continue;
      const key = founder.coordinates.join(",");
      groups.set(key, [...(groups.get(key) ?? []), founder]);
    }
    const markers = [...groups.values()].map((group) => {
      const founder =
        group.find((f) => f.handle === selected?.handle) ?? group[0];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-avatar-pin";
      button.style.display = "none";
      button.dataset.selected = String(
        group.some((f) => f.handle === selected?.handle),
      );
      button.setAttribute(
        "aria-label",
        group.length > 1
          ? `Explore ${group.length} founders on this page in ${founder.city}`
          : `Meet ${founder.name} in ${founder.city}`,
      );
      button.title =
        group.length > 1
          ? `${founder.city} · ${group.length} on this page`
          : founder.name;
      const initials = document.createElement("span");
      initials.className = "map-avatar-initials";
      initials.textContent = founder.name
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("");
      button.append(initials);
      const url = safeHttpUrl(founder.avatarUrl);
      if (url) {
        const img = document.createElement("img");
        img.alt = "";
        img.width = 44;
        img.height = 44;
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => img.remove(), { once: true });
        img.src = url;
        button.append(img);
      }
      if (group.length > 1) {
        const badge = document.createElement("span");
        badge.className = "map-avatar-count";
        badge.textContent = String(group.length);
        button.append(badge);
      }
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (group.length > 1) selectGroup.current(group.map((f) => f.handle));
        else select.current(founder.handle);
      });
      return new maplibregl.Marker({
        element: button,
        anchor: "bottom",
        offset: [0, -12],
      })
        .setLngLat(founder.coordinates!)
        .addTo(map);
    });
    // Only replace visible, unclustered points with portraits. Clustered founders
    // are represented by the map's count layer until the user zooms in.
    const coordinateKey = (coordinates: number[]) =>
      coordinates.map((value) => value.toFixed(5)).join(",");
    const syncVisibility = () => {
      if (!map.getLayer("founder-pins")) return;
      const visible = new Set(
        map
          .queryRenderedFeatures({ layers: ["founder-pins"] })
          .filter((feature) => feature.geometry.type === "Point")
          .map((feature) => String(feature.properties.pointKey)),
      );
      for (const marker of markers) {
        const point = marker.getLngLat();
        marker.getElement().style.display = visible.has(
          coordinateKey([point.lng, point.lat]),
        )
          ? ""
          : "none";
      }
    };
    map.on("render", syncVisibility);
    syncVisibility();
    return () => {
      map.off("render", syncVisibility);
      markers.forEach((marker) => marker.remove());
    };
  }, [founders, selected]);
  useEffect(() => {
    const source = instance.current?.getSource("founders") as
      GeoJSONSource | undefined;
    source?.setData(collection(founders, places));
  }, [founders, places]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !selected?.coordinates) return;
    map.easeTo({
      center: selected.coordinates,
      zoom: Math.max(map.getZoom(), 5),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 800,
    });
  }, [selected]);
  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        aria-label="World map. Use the founder list to select a city."
      />
      {failed ? (
        <p className="map-failure" role="status">
          Map tiles are unavailable. You can still explore every founder in the
          list.
        </p>
      ) : null}
      <button
        className="map-reset"
        onClick={() =>
          instance.current?.easeTo({ center: [12, 28], zoom: 1.4, duration: 0 })
        }
      >
        ◎ World view
      </button>
    </>
  );
}

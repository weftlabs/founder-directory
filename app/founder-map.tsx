"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapInstance,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DiscoveryFounder, MapPlace } from "@/lib/discovery";

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
      properties,
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
}: {
  founders: DiscoveryFounder[];
  places?: MapPlace[];
  onSelectPlace?: (city: string, country: string) => void;
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
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    data.current = collection(founders, places);
    selectPlace.current = onSelectPlace;
    select.current = onSelect;
    selectGroup.current = onSelectGroup;
  }, [founders, places, onSelect, onSelectGroup, onSelectPlace]);
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
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.on("error", () => setFailed(true));
    map.on("load", () => {
      setFailed(false);
      map.addSource("founders", {
        type: "geojson",
        data: data.current,
        cluster: true,
        clusterProperties: { founderCount: ["+", ["get", "count"]] },
        clusterRadius: 42,
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
      instance.current = null;
      map.remove();
    };
  }, []);
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
    const marker = new maplibregl.Marker({ color: "#f4f1e8" })
      .setLngLat(selected.coordinates)
      .addTo(map);
    return () => {
      marker.remove();
    };
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

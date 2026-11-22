import { createHash } from "node:crypto";
import { slabPolygons } from "../plans/building";
import { wallMaterialFootprint } from "../plans/footprints";
import type { Point } from "../plans/model";
import { doorBounds, pointAlong } from "../plans/openings";
import { signedAreaMm2 } from "../plans/polygon";
import { planStoreys, storeyOf } from "../plans/storeys";
import type { StudioDocument } from "../plans/studio-document";

const chars =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function globalId(seed: string) {
  let n = BigInt(
    "0x" + createHash("sha256").update(seed).digest("hex").slice(0, 32),
  );
  let value = "";
  for (let i = 0; i < 22; i++) {
    value = chars[Number(n & 63n)] + value;
    n >>= 6n;
  }
  return "'" + value + "'";
}

function string(text: string) {
  return (
    "'" +
    text
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .replace(/[^\x20-\x7e]|['\\]/g, (c) =>
        c === "'"
          ? "''"
          : "\\X2\\" +
            c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0") +
            "\\X0\\",
      ) +
    "'"
  );
}

const list = (entries: string[]) => "(" + entries.join(",") + ")";
function real(n: number) {
  const value = String(Number(n.toFixed(6)));
  return value.includes(".") ? value : value + ".";
}

export function renderIfc(document: StudioDocument) {
  const { graph: plan } = document;
  const lines: string[] = [];
  function add(type: string, ...values: string[]) {
    const id = "#" + (lines.length + 1);
    lines.push(id + "=" + type + list(values) + ";");
    return id;
  }
  const id = (kind: string, value = "") =>
    globalId(document.id + "/" + kind + "/" + value);
  const point = (...p: number[]) => add("IFCCARTESIANPOINT", list(p.map(real)));
  const axis = (z = 0) => add("IFCAXIS2PLACEMENT3D", point(0, 0, z), "$", "$");
  const baseAxis = axis();
  const vertical = add("IFCDIRECTION", "(0.,0.,1.)");
  const place = (parent: string, z = 0) =>
    add("IFCLOCALPLACEMENT", parent, z === 0 ? baseAxis : axis(z));
  const context = add(
    "IFCGEOMETRICREPRESENTATIONCONTEXT",
    "$",
    "'Model'",
    "3",
    "0.00001",
    baseAxis,
    "$",
  );
  const millimetres = add(
    "IFCSIUNIT",
    "*",
    ".LENGTHUNIT.",
    ".MILLI.",
    ".METRE.",
  );
  const units = add("IFCUNITASSIGNMENT", list([millimetres]));
  const project = add(
    "IFCPROJECT",
    id("project"),
    "$",
    string(document.name),
    "$",
    "$",
    "$",
    "$",
    list([context]),
    units,
  );
  const sitePlace = place("$");
  const site = add(
    "IFCSITE",
    id("site"),
    "$",
    "'Site'",
    "$",
    "$",
    sitePlace,
    "$",
    "$",
    ".ELEMENT.",
    "$",
    "$",
    "$",
    "$",
    "$",
  );
  const buildingPlace = place(sitePlace);
  const building = add(
    "IFCBUILDING",
    id("building"),
    "$",
    string(document.name),
    "$",
    "$",
    buildingPlace,
    "$",
    "$",
    ".ELEMENT.",
    "$",
    "$",
    "$",
  );

  function aggregate(key: string, parent: string, children: string[]) {
    add(
      "IFCRELAGGREGATES",
      id("aggregate", key),
      "$",
      "$",
      "$",
      parent,
      list(children),
    );
  }
  aggregate("project", project, [site]);
  aggregate("site", site, [building]);

  function curve(ring: Point[], hole: boolean) {
    let points = ring.map(({ x, y }) => ({ x, y: -y }));
    if (signedAreaMm2(points) > 0 === hole) points = points.reverse();
    const vertices = points.map(({ x, y }) => point(x, y));
    return add("IFCPOLYLINE", list([...vertices, vertices[0]]));
  }

  function representation(
    polygons: Point[][][],
    bottom: number,
    depth: number,
  ) {
    const solids = polygons.map(([outer, ...holes]) => {
      const perimeter = curve(outer, false);
      const profile = holes.length
        ? add(
            "IFCARBITRARYPROFILEDEFWITHVOIDS",
            ".AREA.",
            "$",
            perimeter,
            list(holes.map((ring) => curve(ring, true))),
          )
        : add("IFCARBITRARYCLOSEDPROFILEDEF", ".AREA.", "$", perimeter);
      return add(
        "IFCEXTRUDEDAREASOLID",
        profile,
        bottom === 0 ? baseAxis : axis(bottom),
        vertical,
        real(depth),
      );
    });
    if (!solids.length) return "$";
    const shape = add(
      "IFCSHAPEREPRESENTATION",
      context,
      "'Body'",
      "'SweptSolid'",
      list(solids),
    );
    return add("IFCPRODUCTDEFINITIONSHAPE", "$", "$", list([shape]));
  }

  const relatedTypes = new Map<string, string[]>();
  const types = new Map<string, string>();
  const storeys: string[] = [];
  const openingTags = new Map<string, string>();
  for (const item of plan.documentItems ?? [])
    if (item.kind === "tag")
      openingTags.set(item.target.kind + ":" + item.target.id, item.text);
  const assembly = new Map(
    (plan.wallTypes ?? []).map((item) => [item.id, item]),
  );
  const assigned = new Map<string, string>();
  for (const level of [...planStoreys(plan)].sort(
    (a, b) => a.elevationMm - b.elevationMm,
  )) {
    const levelPlace = place(buildingPlace, level.elevationMm);
    const floor = add(
      "IFCBUILDINGSTOREY",
      id("level", level.id),
      "$",
      string(level.name),
      "$",
      "$",
      levelPlace,
      "$",
      "$",
      ".ELEMENT.",
      real(level.elevationMm),
    );
    storeys.push(floor);
    const elements: string[] = [];
    for (const wall of plan.walls.filter(
      (item) => storeyOf(item) === level.id,
    )) {
      const name = wall.wallTypeId
        ? assembly.get(wall.wallTypeId)!.name
        : wall.kind === "exterior"
          ? "Exterior wall"
          : "Interior wall";
      const typeKey = wall.wallTypeId
        ? "assembly/" + wall.wallTypeId
        : wall.kind + "/" + wall.thicknessMm;
      if (!types.has(typeKey)) {
        const type = add(
          "IFCWALLTYPE",
          id("walltype", typeKey),
          "$",
          string(
            wall.wallTypeId ? name : name + " " + wall.thicknessMm + " mm",
          ),
          "$",
          "$",
          "$",
          "$",
          "$",
          "$",
          ".STANDARD.",
        );
        types.set(typeKey, type);
        const layers = wall.wallTypeId
          ? (assembly.get(wall.wallTypeId)?.layers ?? [])
          : [{ material: name, thicknessMm: wall.thicknessMm }];
        const materialLayers = layers.map(({ material, thicknessMm }) => {
          if (!assigned.has(material))
            assigned.set(
              material,
              add("IFCMATERIAL", string(material), "$", "$"),
            );
          return add(
            "IFCMATERIALLAYER",
            assigned.get(material)!,
            real(thicknessMm),
            "$",
            "$",
            "$",
            "$",
            "$",
          );
        });
        const materialSet = add(
          "IFCMATERIALLAYERSET",
          list(materialLayers),
          string(name),
          "$",
        );
        add(
          "IFCRELASSOCIATESMATERIAL",
          id("materials", typeKey),
          "$",
          "$",
          "$",
          list([type]),
          materialSet,
        );
      }
      const wallShape = representation(
        [[wallMaterialFootprint(wall)]],
        0,
        level.wallHeightMm,
      );
      const wallElement = add(
        "IFCWALL",
        id("wall", wall.id),
        "$",
        string(name),
        "$",
        "$",
        levelPlace,
        wallShape,
        string(wall.id),
        ".STANDARD.",
      );
      elements.push(wallElement);
      if (!relatedTypes.has(typeKey)) relatedTypes.set(typeKey, []);
      relatedTypes.get(typeKey)!.push(wallElement);
      for (const item of [...plan.openings, ...(plan.windows ?? [])]) {
        if (item.wallId !== wall.id) continue;
        const window = "sillMm" in item;
        const kind = window ? "window" : "door";
        const tag = openingTags.get(kind + ":" + item.id) ?? item.id;
        const height = window
          ? item.heightMm
          : Math.min(2100, level.wallHeightMm);
        const sill = window ? item.sillMm : 0;
        const [a, b] = doorBounds(item);
        const segment = {
          start: pointAlong(wall, a),
          end: pointAlong(wall, b),
        };
        const cut = representation(
          [[wallMaterialFootprint(wall, segment)]],
          sill,
          height,
        );
        const opening = add(
          "IFCOPENINGELEMENT",
          id("void", item.id),
          "$",
          string("Opening for " + tag),
          "$",
          "$",
          levelPlace,
          cut,
          "$",
          ".OPENING.",
        );
        add(
          "IFCRELVOIDSELEMENT",
          id("void-link", item.id),
          "$",
          "$",
          "$",
          wallElement,
          opening,
        );
        const filling = representation(
          [[wallMaterialFootprint(wall, segment)]],
          sill,
          height,
        );
        const element = add(
          window ? "IFCWINDOW" : "IFCDOOR",
          id(kind, item.id),
          "$",
          string(tag),
          "$",
          "$",
          levelPlace,
          filling,
          string(tag),
          real(height),
          real(item.widthMm),
          window ? ".WINDOW." : ".DOOR.",
          "$",
          "$",
        );
        add(
          "IFCRELFILLSELEMENT",
          id("fill-link", item.id),
          "$",
          "$",
          "$",
          opening,
          element,
        );
        elements.push(element);
      }
    }
    for (const item of plan.buildingElements ?? []) {
      if (item.kind !== "slab" || item.storeyId !== level.id) continue;
      const polygons = slabPolygons(plan, item);
      if (!polygons.length) continue;
      const shape = representation(
        polygons,
        item.offsetMm - item.thicknessMm,
        item.thicknessMm,
      );
      elements.push(
        add(
          "IFCSLAB",
          id("slab", item.id),
          "$",
          string(item.name),
          "$",
          "$",
          levelPlace,
          shape,
          string(item.id),
          ".FLOOR.",
        ),
      );
    }
    if (elements.length)
      add(
        "IFCRELCONTAINEDINSPATIALSTRUCTURE",
        id("contain", level.id),
        "$",
        "$",
        "$",
        list(elements),
        floor,
      );
  }
  aggregate("building", building, storeys);
  for (const [key, related] of relatedTypes)
    add(
      "IFCRELDEFINESBYTYPE",
      id("type-link", key),
      "$",
      "$",
      "$",
      list(related),
      types.get(key)!,
    );

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Draft architectural interchange'),'2;1');",
    "FILE_NAME(" +
      [
        string(document.name + " r" + document.revision),
        string(new Date().toISOString().slice(0, 19)),
        "('')",
        "('')",
        "'Draft'",
        "'Draft'",
        "''",
      ].join(",") +
      ");",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

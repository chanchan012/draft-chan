import { useRef, useState, type FormEvent } from "react";
import type {
  DraftPlanState,
  PlanCommand,
  Point,
  Underlay,
  UnderlayCalibration,
} from "@/lib/plans/model";
import { underlayPoint, underlayTransform } from "@/lib/plans/underlays";
import type { UnderlayPreview } from "./underlay-preview";

const at = (x: number, y: number) => ({ x, y });
function defaults(width: number): UnderlayCalibration {
  return { pixels: [at(0, 0), at(width, 0)], model: [at(0, 0), at(3000, 0)] };
}

function CalibrationForm({
  source,
  existing,
  onSave,
}: {
  source: UnderlayPreview;
  existing?: Underlay;
  onSave(
    calibration: UnderlayCalibration,
    opacity: number,
    visible: boolean,
  ): void;
}) {
  const [coordinates, setCoordinates] = useState(
    existing?.calibration ?? defaults(source.width),
  );
  const [check, setCheck] = useState<Point>();
  const [next, setNext] = useState<0 | 1 | 2>(0);
  const [error, setError] = useState("");
  let scale: string | undefined;
  let checkWorld: Point | undefined;
  try {
    scale = underlayTransform(coordinates).scale.toFixed(4);
    if (check) checkWorld = underlayPoint(coordinates, check);
  } catch {
    // The scale is hidden until the coordinate inputs form a valid pair.
  }

  function change(
    key: "pixels" | "model",
    index: 0 | 1,
    axis: "x" | "y",
    value: number,
  ) {
    setCoordinates((current) => {
      const points: [Point, Point] = [...current[key]];
      points[index] = { ...points[index], [axis]: value };
      return { ...current, [key]: points };
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      onSave(coordinates, Number(fields.get("opacity")), fields.has("visible"));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The calibration could not be saved.",
      );
    }
  }

  return (
    <form className="studio-fields interchange-calibration" onSubmit={save}>
      <div
        role="group"
        aria-label="Pick image point"
        className="interchange-choices"
      >
        {(["Point A", "Point B", "Check point"] as const).map(
          (label, index) => (
            <button
              type="button"
              aria-pressed={next === index}
              key={label}
              onClick={() => setNext(index as 0 | 1 | 2)}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <svg
        role="img"
        aria-label="Underlay calibration image"
        viewBox={`0 0 ${source.width} ${source.height}`}
        className="interchange-preview"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = Math.round(
            ((event.clientX - box.left) * source.width) / box.width,
          );
          const y = Math.round(
            ((event.clientY - box.top) * source.height) / box.height,
          );
          if (next === 2) setCheck(at(x, y));
          else {
            change("pixels", next, "x", x);
            change("pixels", next, "y", y);
            setNext(next === 0 ? 1 : 2);
          }
        }}
      >
        <image
          href={source.raster}
          width={source.width}
          height={source.height}
        />
        {[...coordinates.pixels, ...(check ? [check] : [])].map((point, i) => (
          <circle
            key={i}
            cx={point.x}
            cy={point.y}
            r={Math.max(source.width, source.height) / 55}
            fill={i === 2 ? "#bb692a" : "#23796f"}
            stroke="white"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {([0, 1] as const).map((i) => (
        <fieldset key={i}>
          <legend>Point {i === 0 ? "A" : "B"}</legend>
          <div className="studio-cad-parameters">
            {(["pixels", "model"] as const).flatMap((key) =>
              (["x", "y"] as const).map((axis) => (
                <label key={key + axis}>
                  {key === "pixels" ? "Image" : "Plan"} {axis.toUpperCase()} (
                  {key === "pixels" ? "px" : "mm"})
                  <input
                    type="number"
                    required
                    min={key === "pixels" ? 0 : -1_000_000}
                    max={
                      key === "model"
                        ? 1_000_000
                        : axis === "x"
                          ? source.width
                          : source.height
                    }
                    value={coordinates[key][i][axis]}
                    onChange={(event) =>
                      change(
                        key,
                        i,
                        axis,
                        event.currentTarget.valueAsNumber || 0,
                      )
                    }
                  />
                </label>
              )),
            )}
          </div>
        </fieldset>
      ))}
      {scale && <output aria-label="Calibration scale">{scale} mm/px</output>}
      {checkWorld && (
        <output aria-label="Calibrated check point">
          Check at {checkWorld.x.toFixed(1)}, {checkWorld.y.toFixed(1)} mm
        </output>
      )}
      <label>
        Opacity
        <input
          name="opacity"
          type="number"
          min="0.1"
          max="0.8"
          step="0.01"
          required
          defaultValue={existing?.opacity ?? 0.42}
        />
      </label>
      <label className="interchange-toggle">
        <input
          name="visible"
          type="checkbox"
          defaultChecked={existing?.visible ?? true}
        />{" "}
        Show on plan
      </label>
      {error && (
        <p className="interchange-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="studio-cad-apply">
        {existing ? "Save calibration" : "Attach underlay"}
      </button>
    </form>
  );
}

export function UnderlayPanel({
  plan,
  storeyId,
  onEdit,
}: {
  plan: DraftPlanState;
  storeyId: string;
  onEdit(commands: PlanCommand[]): void;
}) {
  const [preview, setPreview] = useState<UnderlayPreview>();
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const items =
    plan.underlays?.filter((item) => item.storeyId === storeyId) ?? [];
  const existing = items.find((item) => item.id === id);
  const source = preview ?? existing;

  async function load(file: File) {
    const latest = ++request.current;
    setBusy(true);
    setError("");
    try {
      const { previewUnderlay } = await import("./underlay-preview");
      const result = await previewUnderlay(file, page);
      if (latest !== request.current) return;
      setId("");
      setPreview(result);
    } catch (cause) {
      if (latest === request.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The underlay could not be opened.",
        );
    } finally {
      if (latest === request.current) setBusy(false);
    }
  }

  return (
    <>
      <label>
        PDF page
        <input
          type="number"
          min="1"
          max="1000"
          value={page}
          onChange={(event) => setPage(event.currentTarget.valueAsNumber || 1)}
        />
      </label>
      <label>
        Underlay file
        <input
          aria-label="Underlay file"
          type="file"
          accept=".pdf,image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void load(file);
          }}
        />
      </label>
      {items.length > 0 && (
        <label>
          Saved underlay
          <select
            value={id}
            onChange={(event) => {
              request.current++;
              setBusy(false);
              setPreview(undefined);
              setId(event.currentTarget.value);
            }}
          >
            <option value="">Choose underlay</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {busy && <p role="status">Rendering preview…</p>}
      {error && (
        <p role="alert" className="interchange-error">
          {error}
        </p>
      )}
      {source && (
        <CalibrationForm
          key={existing?.id ?? source.raster.slice(-80)}
          source={source}
          existing={existing}
          onSave={(calibration, opacity, visible) => {
            const nextId = existing?.id ?? crypto.randomUUID();
            onEdit([
              {
                type: "underlay.write",
                item: {
                  ...source,
                  id: nextId,
                  storeyId,
                  calibration,
                  opacity,
                  visible,
                },
              },
            ]);
            setId(nextId);
            setPreview(undefined);
          }}
        />
      )}
      {existing && (
        <button
          className="interchange-action"
          type="button"
          onClick={() => {
            try {
              onEdit([{ type: "underlay.remove", id: existing.id }]);
              setId("");
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "The underlay could not be removed.",
              );
            }
          }}
        >
          Remove underlay
        </button>
      )}
    </>
  );
}

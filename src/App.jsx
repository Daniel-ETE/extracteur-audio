import { useState, useRef, useEffect, useCallback } from "react";
import {
  UploadCloud, FileVideo, Music, Play, Pause, Download, X, Loader2,
  CheckCircle2, AlertCircle, RotateCcw, Sparkles, Zap, AudioLines, Headphones,
} from "lucide-react";

/* ---------- Constantes ---------- */
const FORMATS = {
  mp3: { label: "MP3", ext: "mp3", mime: "audio/mpeg", args: (b) => ["-c:a", "libmp3lame", "-b:a", `${b}k`, "-compression_level", "7"] },
  wav: { label: "WAV", ext: "wav", mime: "audio/wav", args: () => ["-c:a", "pcm_s16le"] },
  aac: { label: "AAC", ext: "m4a", mime: "audio/mp4", args: (b) => ["-c:a", "aac", "-b:a", `${b}k`] },
  // Copie directe de la piste audio, sans réencodage : quasi instantané, qualité d'origine
  copy: { label: "Original", ext: "m4a", mime: "audio/mp4", args: () => ["-c:a", "copy"] },
};
const COPY_EXT = { aac: "m4a", alac: "m4a", mp3: "mp3", opus: "opus", vorbis: "ogg", flac: "flac", ac3: "ac3", eac3: "eac3", pcm_s16le: "wav" };
const COPY_MIME = { m4a: "audio/mp4", mp3: "audio/mpeg", opus: "audio/ogg", ogg: "audio/ogg", flac: "audio/flac", wav: "audio/wav", ac3: "audio/ac3", eac3: "audio/eac3" };
const BITRATES = [128, 192, 320];
// Moteur FFmpeg servi depuis public/ffmpeg (compatible avec le "base" de Vite)
const CORE_URL = `${import.meta.env.BASE_URL}ffmpeg`;
const MOUNT = "/work";
const STEPS = ["Importer", "Régler", "Écouter"];
const BARS = Array.from({ length: 44 }, (_, i) => 28 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 72));

const formatSize = (bytes) =>
  bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

const formatTime = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/* ---------- Polices (via @fontsource, importées dans main.jsx) + animations ---------- */
const STYLES = `
.ff-body { font-family: "Plus Jakarta Sans Variable", system-ui, sans-serif; }
.ff-display { font-family: "Fraunces Variable", Georgia, serif; font-optical-sizing: auto; letter-spacing: -0.02em; }
.ff-mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes floaty { 0%,100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-8px) rotate(3deg); } }
@keyframes pop { 0% { opacity: 0; transform: scale(.92); } 60% { transform: scale(1.02); } 100% { opacity: 1; transform: scale(1); } }
@keyframes shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
@keyframes ring { 0% { box-shadow: 0 0 0 0 rgba(200,109,81,.45); } 100% { box-shadow: 0 0 0 18px rgba(200,109,81,0); } }
@keyframes eq { 0%,100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
@keyframes drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(24px,-18px); } }
@keyframes shine { from { transform: translateX(-120%) skewX(-20deg); } to { transform: translateX(260%) skewX(-20deg); } }
@keyframes gradientMove { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
.anim-fade-up { animation: fadeUp .7s cubic-bezier(.2,.8,.2,1) both; }
.anim-float { animation: floaty 4s ease-in-out infinite; }
.anim-pop { animation: pop .5s cubic-bezier(.2,.8,.2,1) both; }
.anim-ring { animation: ring 1.6s ease-out infinite; }
.anim-drift { animation: drift 10s ease-in-out infinite; }
.anim-shimmer { background-image: linear-gradient(90deg,#C86D51 0%,#e8a28b 50%,#C86D51 100%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
.text-gradient { background: linear-gradient(110deg,#6E8574,#849B89 35%,#C86D51 75%,#B55B40); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: gradientMove 8s ease-in-out infinite; }
.eq-bar { transform-origin: bottom; animation: eq 1s ease-in-out infinite; }
.btn-shine { position: relative; overflow: hidden; }
.btn-shine::after { content: ""; position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent); transform: translateX(-120%) skewX(-20deg); }
.btn-shine:not(:disabled):hover::after { animation: shine .9s ease; }
@media (prefers-reduced-motion: reduce) { .anim-fade-up,.anim-float,.anim-pop,.anim-ring,.anim-drift,.anim-shimmer,.text-gradient,.eq-bar { animation: none !important; } }
`;

/* ---------- Composant principal ---------- */
export default function App() {
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [status, setStatus] = useState("idle"); // idle | converting | done | error
  const [engineReady, setEngineReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);

  const ffmpegRef = useRef(null);
  const loadingRef = useRef(null);
  const logsRef = useRef([]);
  const inputRef = useRef(null);

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  const loadFFmpeg = useCallback(() => {
    if (ffmpegRef.current?.loaded) return Promise.resolve(ffmpegRef.current);
    if (loadingRef.current) return loadingRef.current;
    loadingRef.current = (async () => {
      // Chargé à la demande : la page s'affiche même si le moteur met du temps
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }) => { logsRef.current.push(message); });
      ffmpeg.on("progress", ({ progress: p }) => {
        if (Number.isFinite(p)) setProgress(Math.min(99, Math.max(0, Math.round(p * 100))));
      });
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegRef.current = ffmpeg;
      setEngineReady(true);
      return ffmpeg;
    })().catch((e) => { loadingRef.current = null; throw e; });
    return loadingRef.current;
  }, []);

  useEffect(() => { loadFFmpeg().catch(() => {}); }, [loadFFmpeg]);

  // Lit le codec de la piste audio (ex. "aac", "mp3", "opus") en quelques millisecondes
  const probeAudioCodec = async (ffmpeg, inPath) => {
    logsRef.current = [];
    await ffmpeg.exec(["-hide_banner", "-i", inPath]).catch(() => {});
    const match = logsRef.current.join("\n").match(/Audio:\s*([a-z0-9_]+)/i);
    return match ? match[1].toLowerCase() : null;
  };

  const reset = () => {
    setFile(null); setResult(null); setProgress(0); setError(""); setStatus("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const pickFile = (f) => {
    if (!f) return;
    const isVideo = f.type.startsWith("video/") || /\.(mkv|mov|mp4|webm|avi|flv|wmv|m4v)$/i.test(f.name);
    if (!isVideo) {
      setResult(null); setFile(null);
      setError("Ce fichier n'est pas une vidéo reconnue.");
      setStatus("error");
      return;
    }
    reset();
    setFile(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0]);
  };

  const convert = async () => {
    if (!file) return;
    const fmt = FORMATS[format];
    setResult(null); setError(""); setProgress(0); setStatus("converting");

    const t0 = performance.now();
    const inName = "input" + (file.name.match(/\.[^.]+$/)?.[0] ?? ".mp4");
    let outExt = fmt.ext;
    let outMime = fmt.mime;
    let copy = false;
    let outName = `output.${outExt}`;
    let ffmpeg, mounted = false, wroteInput = false;

    try {
      ffmpeg = await loadFFmpeg();
      let inPath;
      try {
        await ffmpeg.createDir(MOUNT).catch(() => {});
        await ffmpeg.mount("WORKERFS", { files: [file] }, MOUNT);
        mounted = true;
        inPath = `${MOUNT}/${file.name}`;
      } catch {
        await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
        wroteInput = true;
        inPath = inName;
      }

      if (format !== "wav") {
        const codec = await probeAudioCodec(ffmpeg, inPath);
        if (format === "copy") {
          if (!codec) throw new Error("Aucune piste audio détectée dans cette vidéo.");
          copy = true;
          outExt = COPY_EXT[codec] ?? "mka";
          outMime = COPY_MIME[outExt] ?? "audio/x-matroska";
        } else if (codec === format) {
          copy = true; // même codec que la source : copie directe, instantanée
        }
        outName = `output.${outExt}`;
      }

      const code = await ffmpeg.exec([
        "-i", inPath, "-map", "0:a:0", "-vn", "-sn", "-dn",
        ...(copy ? ["-c:a", "copy"] : fmt.args(bitrate)),
        "-y", outName,
      ]);
      if (code !== 0) throw new Error("La conversion a échoué (la vidéo n'a peut-être pas de piste audio).");

      const data = await ffmpeg.readFile(outName);
      const blob = new Blob([data], { type: outMime });
      setResult({
        blob,
        url: URL.createObjectURL(blob),
        name: `${file.name.replace(/\.[^.]+$/, "")}.${outExt}`,
        elapsed: (performance.now() - t0) / 1000,
        copy,
      });
      setProgress(100);
      setStatus("done");
    } catch (err) {
      console.error(err);
      setError(err?.message || "Une erreur est survenue pendant la conversion.");
      setStatus("error");
    } finally {
      if (ffmpeg?.loaded) {
        if (mounted) {
          await ffmpeg.unmount(MOUNT).catch(() => {});
          await ffmpeg.deleteDir(MOUNT).catch(() => {});
        }
        if (wroteInput) await ffmpeg.deleteFile(inName).catch(() => {});
        await ffmpeg.deleteFile(outName).catch(() => {});
      }
    }
  };

  const busy = status === "converting";
  const step = status === "done" ? 2 : file ? 1 : 0;

  return (
    <div
      className="ff-body relative min-h-screen overflow-hidden text-[#3d4a41]"
      style={{
        backgroundColor: "#FDFBF7",
        backgroundImage:
          "radial-gradient(60rem 40rem at 5% -10%, rgba(132,155,137,.30), transparent 60%), radial-gradient(50rem 36rem at 100% 110%, rgba(200,109,81,.22), transparent 60%), linear-gradient(180deg,#FDFBF7,#F8F4EE)",
      }}
    >
      <style>{STYLES}</style>

      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage: "radial-gradient(rgba(110,133,116,.22) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <div className="anim-drift pointer-events-none absolute -left-28 top-10 h-80 w-80 rounded-full bg-[#849B89]/25 blur-3xl" />
      <div className="anim-drift pointer-events-none absolute -right-28 bottom-10 h-96 w-96 rounded-full bg-[#C86D51]/20 blur-3xl" style={{ animationDelay: "-5s" }} />
      <Headphones className="anim-float pointer-events-none absolute left-[7%] top-[18%] hidden h-10 w-10 text-[#849B89]/40 md:block" />
      <AudioLines className="anim-float pointer-events-none absolute right-[8%] top-[28%] hidden h-12 w-12 text-[#C86D51]/35 md:block" style={{ animationDelay: "-2s" }} />
      <Music className="anim-float pointer-events-none absolute bottom-[16%] left-[10%] hidden h-9 w-9 text-[#C86D51]/30 md:block" style={{ animationDelay: "-1s" }} />

      <main className="relative mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
        {/* En-tête */}
        <header className="anim-fade-up mb-8 text-center">
          <div className="relative mx-auto mb-5 h-16 w-16">
            <div className="anim-float flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-[#849B89] to-[#6E8574] text-white shadow-xl shadow-[#6E8574]/35 ring-4 ring-white/70">
              <AudioLines className="h-8 w-8" />
            </div>
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#C86D51] ring-2 ring-[#FDFBF7]">
              <Sparkles className="h-3 w-3 text-white" />
            </span>
          </div>

          <h1 className="ff-display text-4xl font-bold leading-[1.05] sm:text-6xl">
            Extracteur <span className="text-gradient italic">Audio</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#6b7a70] sm:text-base">
            Transformez n'importe quelle vidéo en fichier audio, <span className="font-semibold text-[#6E8574]">directement dans votre navigateur</span>.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C86D51]/20 bg-[#C86D51]/10 px-3 py-1 text-xs font-semibold text-[#B55B40]">
              <Sparkles className="h-3.5 w-3.5" /> 100% local · aucun envoi
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-500 ${engineReady ? "border-[#849B89]/30 bg-[#849B89]/15 text-[#6E8574]" : "border-[#F3EDE4] bg-[#F3EDE4] text-[#6b7a70]"}`}>
              {engineReady ? <Zap className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {engineReady ? "Moteur prêt" : "Préparation du moteur…"}
            </span>
          </div>
        </header>

        {/* Carte avec bordure dégradée */}
        <div className="anim-fade-up rounded-[2rem] bg-gradient-to-br from-white via-[#849B89]/35 to-[#C86D51]/35 p-px shadow-2xl shadow-[#6E8574]/15" style={{ animationDelay: "120ms" }}>
          <section className="space-y-6 rounded-[calc(2rem-1px)] bg-[#FDFBF7]/80 p-5 backdrop-blur-2xl sm:p-8">
            {/* Étapes */}
            <ol className="flex items-center justify-center gap-2 sm:gap-3" aria-label="Progression">
              {STEPS.map((label, i) => (
                <li key={label} className="flex items-center gap-2 sm:gap-3">
                  <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-500 ${i === step ? "bg-[#849B89] text-white shadow-md shadow-[#849B89]/30" : i < step ? "bg-[#849B89]/15 text-[#6E8574]" : "bg-[#F3EDE4] text-[#6b7a70]"}`}>
                    <span className={`ff-mono flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${i === step ? "bg-white/25" : "bg-white/60"}`}>{i < step ? "✓" : i + 1}</span>
                    {label}
                  </span>
                  {i < STEPS.length - 1 && <span className={`h-px w-4 sm:w-8 ${i < step ? "bg-[#849B89]" : "bg-[#849B89]/25"}`} />}
                </li>
              ))}
            </ol>

            {/* Zone de dépôt / fichier */}
            {!file ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border-2 border-dashed px-6 py-14 text-center transition-all duration-300 ${dragging ? "scale-[1.03] border-[#C86D51] bg-[#C86D51]/10" : "border-[#849B89]/50 bg-gradient-to-b from-[#F8F4EE] to-[#F3EDE4]/70 hover:-translate-y-1 hover:border-[#6E8574] hover:shadow-xl hover:shadow-[#849B89]/20"}`}
              >
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center gap-1 px-6 opacity-30" aria-hidden="true">
                  {BARS.map((h, i) => (
                    <span key={i} className="eq-bar flex-1 rounded-full bg-[#849B89]" style={{ height: `${h}%`, animationDelay: `${(i % 9) * 0.12}s`, animationDuration: `${1.4 + (i % 5) * 0.2}s` }} />
                  ))}
                </div>
                <span className={`relative flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-lg shadow-[#849B89]/20 ${dragging ? "anim-ring" : ""}`}>
                  <UploadCloud className={`h-10 w-10 transition-all duration-300 ${dragging ? "-translate-y-1 text-[#C86D51]" : "text-[#6E8574] group-hover:-translate-y-1 group-hover:text-[#C86D51]"}`} />
                </span>
                <p className="ff-display relative text-xl font-bold sm:text-2xl">{dragging ? "Relâchez pour importer" : "Déposez votre vidéo ici"}</p>
                <p className="relative text-sm text-[#6b7a70]">ou cliquez pour parcourir vos fichiers</p>
                <div className="relative mt-1 flex flex-wrap justify-center gap-1.5">
                  {["MP4", "WEBM", "MOV", "MKV"].map((t) => (
                    <span key={t} className="ff-mono rounded-md border border-[#849B89]/30 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-[#6E8574]">{t}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div key={file.name} className="anim-pop flex items-center gap-4 rounded-3xl border border-[#849B89]/20 bg-gradient-to-r from-[#F8F4EE] to-[#F3EDE4] p-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#849B89] to-[#6E8574] text-white shadow-md shadow-[#849B89]/30">
                  <FileVideo className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{file.name}</p>
                  <p className="ff-mono mt-0.5 text-xs text-[#6b7a70]">{formatSize(file.size)}</p>
                </div>
                <button onClick={reset} disabled={busy} aria-label="Retirer le fichier" className="rounded-full bg-white/70 p-2 text-[#6b7a70] transition hover:rotate-90 hover:bg-[#C86D51]/10 hover:text-[#B55B40] disabled:opacity-40">
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}

            <input ref={inputRef} type="file" accept="video/*,.mkv" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />

            {/* Paramètres */}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Format de sortie">
                <Segmented options={Object.entries(FORMATS).map(([k, v]) => ({ value: k, label: v.label }))} value={format} onChange={setFormat} disabled={busy} />
              </Field>
              <Field
                label="Qualité"
                hint={
                  format === "wav" ? "WAV sans perte : non applicable"
                  : format === "copy" ? "⚡ Copie directe de la piste audio : instantané, qualité d'origine"
                  : null
                }
              >
                <Segmented options={BITRATES.map((b) => ({ value: b, label: `${b} kbps` }))} value={bitrate} onChange={setBitrate} disabled={busy || format === "wav" || format === "copy"} />
              </Field>
            </div>

            {/* Bouton principal */}
            <button
              onClick={convert}
              disabled={!file || busy}
              className="btn-shine flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#C86D51] to-[#B55B40] px-6 py-4 text-base font-bold text-white shadow-lg shadow-[#C86D51]/35 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#C86D51]/45 active:scale-[0.98] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <AudioLines className="h-5 w-5" />}
              {busy ? "Conversion en cours…" : "Extraire l'audio"}
            </button>

            {/* Progression */}
            {busy && (
              <div className="anim-fade-up space-y-2" aria-live="polite">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-[#6b7a70]">{engineReady ? "Extraction de la piste audio…" : "Chargement du moteur…"}</span>
                  <span className="ff-mono text-lg font-bold tabular-nums text-[#B55B40]">{progress}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-[#F3EDE4] shadow-inner">
                  <div className="anim-shimmer h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${Math.max(progress, 4)}%` }} />
                </div>
              </div>
            )}

            {/* Erreur */}
            {status === "error" && (
              <div className="anim-pop flex items-start gap-3 rounded-2xl border border-[#C86D51]/30 bg-[#C86D51]/10 p-4 text-sm text-[#B55B40]">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {/* Résultat */}
            {status === "done" && result && <ResultCard key={result.url} result={result} onReset={reset} />}
          </section>
        </div>

        <footer className="anim-fade-up mt-8 text-center text-xs text-[#6b7a70]" style={{ animationDelay: "240ms" }}>
          © Tous droits réservés <span className="ff-mono font-bold text-[#B55B40]">{"<Daniel.Dev/>"}</span>
        </footer>
      </main>
    </div>
  );
}

/* ---------- Sous-composants ---------- */
function Field({ label, hint, children }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#6E8574]">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[#6b7a70]">{hint}</p>}
    </div>
  );
}

function Segmented({ options, value, onChange, disabled }) {
  return (
    <div className={`flex rounded-2xl bg-[#F3EDE4] p-1 shadow-inner transition-opacity ${disabled ? "opacity-50" : ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-xl px-2 py-2.5 text-sm font-semibold transition-all duration-300 ${value === o.value ? "bg-gradient-to-br from-[#849B89] to-[#6E8574] text-white shadow-md shadow-[#849B89]/30" : "text-[#6E8574] hover:bg-white/70"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ResultCard({ result, onReset }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const max = Number.isFinite(duration) ? duration : 0;
  const ratio = max ? time / max : 0;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seek = (e) => {
    const t = Number(e.target.value);
    audioRef.current.currentTime = t;
    setTime(t);
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = result.url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="anim-pop space-y-5 rounded-3xl border border-[#849B89]/25 bg-gradient-to-br from-[#F8F4EE] to-[#F3EDE4] p-5 shadow-lg shadow-[#849B89]/10">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#849B89]/20 text-[#6E8574]">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="ff-display text-lg font-bold leading-tight">Terminé en {result.elapsed.toFixed(1)} s</p>
          <p className="ff-mono truncate text-xs text-[#6b7a70]">{result.copy ? "⚡ copie directe · " : ""}{result.name}</p>
        </div>
        <span className="ff-mono rounded-full bg-gradient-to-r from-[#C86D51] to-[#B55B40] px-3 py-1 text-xs font-bold text-white shadow-md shadow-[#C86D51]/30">
          {formatSize(result.blob.size)}
        </span>
      </div>

      <audio
        ref={audioRef}
        src={result.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTime(0); }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
      />

      <div className="flex items-center gap-4">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Lecture"}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#849B89] to-[#6E8574] text-white shadow-lg shadow-[#849B89]/40 transition hover:scale-105 active:scale-90 ${playing ? "anim-ring" : ""}`}
        >
          {playing ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
        </button>

        <div className="flex-1">
          <div className="relative h-12">
            <div className="flex h-full items-center gap-[3px]">
              {BARS.map((h, i) => {
                const played = i / BARS.length < ratio;
                return (
                  <span
                    key={i}
                    className={`flex-1 rounded-full transition-colors duration-200 ${played ? "bg-[#C86D51]" : "bg-[#849B89]/35"} ${playing && played ? "eq-bar" : ""}`}
                    style={{ height: `${h}%`, animationDelay: `${(i % 7) * 0.1}s`, animationDuration: `${0.9 + (i % 4) * 0.2}s` }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={max}
              step="0.1"
              value={Math.min(time, max)}
              onChange={seek}
              aria-label="Position de lecture"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <div className="ff-mono mt-1.5 flex justify-between text-[11px] font-medium tabular-nums text-[#6b7a70]">
            <span>{formatTime(time)}</span>
            <span>{formatTime(max)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={download}
          className="btn-shine flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6E8574] to-[#849B89] px-5 py-3.5 font-bold text-white shadow-lg shadow-[#6E8574]/30 transition hover:-translate-y-0.5 active:scale-[0.98]"
        >
          <Download className="h-5 w-5" /> Télécharger
        </button>
        <button
          onClick={onReset}
          className="group flex items-center justify-center gap-2 rounded-2xl bg-white/70 px-5 py-3.5 font-semibold text-[#6E8574] transition hover:bg-white"
        >
          <RotateCcw className="h-4 w-4 transition-transform duration-500 group-hover:-rotate-180" /> Nouvelle vidéo
        </button>
      </div>
    </div>
  );
}ssss
const logEl = document.getElementById("log");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const backendInput = document.getElementById("backendUrl");

let pc;
let dc;
let stream;
let audioEl;

function log(...parts) {
  const line = parts.join(" ");
  console.log(line);
  logEl.textContent += line + "\n";
}

function getBackendBaseUrl() {
  const fromQuery = new URLSearchParams(window.location.search).get("apiBaseUrl");
  const fromInput = backendInput?.value?.trim();
  return fromQuery || fromInput || window.location.origin;
}

async function start() {
  try {
    const apiBaseUrl = getBackendBaseUrl();
    log("using api base:", apiBaseUrl);

    pc = new RTCPeerConnection();

    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        audioEl.srcObject = event.streams[0];
      }
      log("remote track:", event.track.kind);
    };

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(stream.getAudioTracks()[0]);

    dc = pc.createDataChannel("realtime-channel");

    dc.addEventListener("open", () => {
      log("data channel open");

      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Hello. Briefly introduce yourself."
            }
          ]
        }
      }));

      dc.send(JSON.stringify({ type: "response.create" }));
    });

    dc.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        log("event:", msg.type);

        if (msg.type === "response.output_text.delta" && msg.delta) {
          log("text:", msg.delta);
        }

        if (msg.type === "response.output_audio_transcript.done") {
          log("assistant:", msg.transcript || "");
        }
      } catch {
        log("raw:", event.data);
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch(`${apiBaseUrl}/api/realtime/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp"
      },
      body: offer.sdp
    });

    if (!response.ok) {
      throw new Error(`connect failed: ${response.status}`);
    }

    const answer = await response.text();
    const sessionId = response.headers.get("X-Session-Id");

    await pc.setRemoteDescription({
      type: "answer",
      sdp: answer
    });

    log("connected. session:", sessionId);
  } catch (error) {
    log("start failed:", error.message);
  }
}

function stop() {
  if (dc) {
    dc.close();
    dc = undefined;
  }
  if (pc) {
    pc.close();
    pc = undefined;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = undefined;
  }
  if (audioEl) {
    audioEl.remove();
    audioEl = undefined;
  }
  log("stopped");
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

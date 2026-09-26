import './styles/App.css'
import { useRef, useCallback, useState } from "react";
import Webcam from "react-webcam";
import CameraLab from "./pages/CameraLab";
import WalkMode from "./pages/WalkMode";

// Ask for full HD; the browser falls back to the best the camera can do
const videoConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  facingMode: "user"
};

const CustomWebcam = () => {
  const webcamRef = useRef<Webcam>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null)

  // setInterval(() => {
  //   const imageSrc = webcamRef.current.getScreenshot();
  //   console.log(imageSrc)
  //   setImgSrc(null)
  //   console.log("Hi")
  // }, 1000)

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot() ?? null;
    setImgSrc(imageSrc)
    console.log(imageSrc)
  }, [webcamRef])

  return (
    <main className="container">
      <h1>SeeWalk</h1>
      {imgSrc ? (
        <img className="preview" src={imgSrc} alt="webcam" />
      ) : <>
        <Webcam
          className="preview"
          videoConstraints={videoConstraints}
          ref={webcamRef}
          forceScreenshotSourceSize
          screenshotQuality={0.95}
        />
        <button className="capture" onClick={capture}>Capture</button>
      </>}
    </main>
  );
}


function App() {
  // Walk Mode is the app. Aroha's capture page is at …/?capture, Abdul's camera debug page at …/?lab.
  const params = new URLSearchParams(window.location.search);
  if (params.has("lab")) return <CameraLab />;
  if (params.has("capture")) return <CustomWebcam></CustomWebcam>;
  return <WalkMode />;
}

export default App

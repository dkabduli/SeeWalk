import './styles/App.css'
import { useRef, useCallback, useState } from "react";
import Webcam from "react-webcam";
import CameraLab from "./pages/CameraLab";

const deviceWidth = 600
const deviceHeight = 600

const videoConstraints = {
  width: deviceWidth,
  height: deviceHeight,
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
    <div className="container">
      {imgSrc ? (
        <img src={imgSrc} alt="webcam" />
      ) : <>
        <Webcam videoConstraints={videoConstraints} ref={webcamRef} />
        <button onClick={capture}>Capture</button>
      </>}
    </div>
  );
}


function App() {
  // Aroha's page is the app. Abdul's camera debug page lives at …/#lab for testing the camera piece.
  if (window.location.hash === "#lab") return <CameraLab />;
  return (
    <CustomWebcam></CustomWebcam>
  );
}

export default App

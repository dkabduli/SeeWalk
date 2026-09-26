import './styles/App.css'
import React, { useRef, useCallback, useState } from "react";
import Webcam from "react-webcam";

const deviceHeight = 720
const deviceWidth = 1280

const videoConstraints = {
  width: 1280,
  height: 720,
  facingMode: "user"
};

const CustomWebcam = () => {
  const webcamRef = useRef(null);
  const [imgSrc, setImgSrc] = useState(null)

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot();
    setImgSrc(imageSrc)
  }, [webcamRef])

  return (
    <div className="container">
      {imgSrc ? (
        <img src={imgSrc} alt="webcam" />
      ) : (
        <Webcam height={600} width={600} ref={webcamRef} />
      )}
      <div className="btn-container">
        <button onClick={capture}>Capture photo</button>
      </div>
    </div>
  );
}

const WebcamCapture = () => {
  const webcamRef = useRef(null);
  const [capturedImage, setCapturedImage] = useState(null);

  // Capture function using the getScreenshot() ref method
  const capturePhoto = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = Webcam.
      setCapturedImage(imageSrc); // Base64 data string
    }
  }, [webcamRef]);
};

function App() {
  return (
    <CustomWebcam/>
  );
}

export default App

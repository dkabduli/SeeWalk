import './styles/App.css'
import React, { useRef, useCallback, useState } from "react";
import Webcam from "react-webcam";

const deviceWidth = 600
const deviceHeight = 600

const videoConstraints = {
  width: deviceWidth,
  height: deviceHeight,
  facingMode: "user"
};

const CustomWebcam = () => {
  const webcamRef = useRef(null);
  const [imgSrc, setImgSrc] = useState(null)

  // setInterval(() => {
  //   const imageSrc = webcamRef.current.getScreenshot();
  //   console.log(imageSrc)
  //   setImgSrc(null)
  //   console.log("Hi")
  // }, 1000)

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot();
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
  return (
    <CustomWebcam></CustomWebcam>
  );
}

export default App

import './styles/App.css'
import { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";

const deviceWidth = 600;
const deviceHeight = 600;
const facingMode= "user"

const videoConstraints = {
    width: deviceWidth,
    height: deviceHeight,
    facingMode: facingMode
};

const CustomWebcam = () => {
    const webcamRef = useRef<any>(null);
    //const [imgSrc, setImgSrc] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);

    useEffect(() => {
        if (!isRunning) return;

        let running = true;

        const detect = async () => {
            while (running) {
                const imageSrc = webcamRef.current?.getScreenshot({width: 384, height: 384});

                if (!imageSrc) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                try {
                    console.log("Sending Info..");

                    const info = await fetch("http://localhost:8001/detect", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ image: imageSrc })
                    });

                    const result = await info.json();

                    console.log("Status:", info.status);
                    console.log("Response:", result);
                    console.log("Gemini:", result.result);
                } catch (e) {
                    console.log(e);
                }

                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        };

        detect();

        return () => {
            running = false;
        };
    }, [isRunning]);

    return (
        <main className="container">
          <h1>SeeWalk</h1>
            <Webcam
                audio={false}
                screenshotFormat="image/jpeg"
                videoConstraints={videoConstraints}
                ref={webcamRef}
            />

            <button onClick={() => setIsRunning(prev => !prev)}>
                {isRunning ? "Pause" : "Resume"}
            </button>
        </main>
    );
};

function App() {
  return (
    <CustomWebcam></CustomWebcam>
  );
}

export default App;
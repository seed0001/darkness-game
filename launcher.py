import subprocess
import webbrowser
import time
import os
import sys

def launch():
    print("--- Darkness - 3D Environment Launcher ---")
    
    # 1. Check if we're in the right directory
    if not os.path.exists("package.json"):
        print("Error: package.json not found. Please run this in the project root.")
        return

    # 2. Check for node_modules (optional but helpful)
    if not os.path.exists("node_modules"):
        print("Installing dependencies (first time setup)...")
        try:
            subprocess.run(["npm", "install"], check=True, shell=True)
        except Exception as e:
            print(f"Failed to install dependencies: {e}")
            return

    # 3. Start the Vite development server
    print("Starting the development server on http://localhost:3000...")
    try:
        # We'll use Popen so the server runs in the background
        # Added shell=True for Windows compatibility
        server_process = subprocess.Popen(
            ["npm", "run", "dev", "--", "--port", "3000"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=True
        )
    except Exception as e:
        print(f"Failed to start the server: {e}")
        return

    # 4. Wait for the server to spin up
    print("Waiting 5 seconds for initialization...")
    time.sleep(5)

    # 5. Open the browser
    print("Launching browser...")
    webbrowser.open("http://localhost:3000")

    print("\nEnvironment is now live!")
    print("You can close this window to exit.")
    
    try:
        # Keep the script alive while the server runs
        server_process.wait()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server_process.terminate()
        sys.exit(0)

if __name__ == "__main__":
    launch()

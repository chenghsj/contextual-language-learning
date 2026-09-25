// A minimal Windows Native Messaging host launcher. Chrome requires a real .exe.
// The Node runtime and compiled JS entry are configured by the local installer;
// stdin/stdout are forwarded as raw bytes, preserving Chrome's length-prefixed frames.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

internal static class NativeHostLauncher
{
    private static void Copy(Stream input, Stream output, bool closeOutput)
    {
        try
        {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                output.Write(buffer, 0, read);
                output.Flush(); // Flush each Native Messaging frame; the port stays open.
            }
        }
        catch (IOException) { /* Browser disconnected. */ }
        catch (ObjectDisposedException) { /* Child already exited. */ }
        finally
        {
            if (closeOutput) { try { output.Close(); } catch (IOException) { } }
        }
    }

    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = File.ReadAllText(Path.Combine(root, "node-path.txt"), Encoding.UTF8).Trim();
            string entry = Path.Combine(root, "native-host.mjs");
            if (!Path.IsPathRooted(node) || !File.Exists(node) || !File.Exists(entry))
            {
                Console.Error.WriteLine("Native Host installation is incomplete. Re-run the Host installer.");
                return 1;
            }
            ProcessStartInfo info = new ProcessStartInfo(node, "\"" + entry + "\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            using (Process child = Process.Start(info))
            {
                if (child == null) return 1;
                Task stdin = Task.Run(() => Copy(Console.OpenStandardInput(), child.StandardInput.BaseStream, true));
                Task stdout = Task.Run(() => Copy(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), false));
                Task stderr = Task.Run(() => Copy(child.StandardError.BaseStream, Console.OpenStandardError(), false));
                child.WaitForExit();
                stdout.Wait();
                stderr.Wait();
                // The browser may keep stdin open until its port closes; never block exit on it.
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Native Host launcher failed: " + error.Message);
            return 1;
        }
    }
}

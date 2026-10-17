using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class SetupLauncher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "runtime", "node.exe");
            string script = Path.Combine(root, "setup", "server.mjs");
            if (!File.Exists(node) || !File.Exists(script)) throw new Exception("Please extract the complete ZIP before opening Setup.");
            ProcessStartInfo info = new ProcessStartInfo(node, "\"" + script + "\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WorkingDirectory = root;
            using (Process child = Process.Start(info))
            {
                child.WaitForExit();
                if (child.ExitCode != 0) throw new Exception("Setup could not start. Download the package for this computer's architecture.");
            }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Contextual Language Learning", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

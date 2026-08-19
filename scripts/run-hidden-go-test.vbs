Option Explicit

Dim shell, fileSystem, arguments
Dim executable, commandLine, outputPath, errorPath, exitCode
Dim index, temporaryFolder

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set arguments = WScript.Arguments

If arguments.Count = 0 Then
    WScript.StdErr.WriteLine "run-hidden-go-test.vbs requires a test executable"
    WScript.Quit 64
End If

executable = arguments(0)
temporaryFolder = fileSystem.GetSpecialFolder(2)
outputPath = fileSystem.BuildPath(temporaryFolder, fileSystem.GetTempName)
errorPath = fileSystem.BuildPath(temporaryFolder, fileSystem.GetTempName)

commandLine = QuoteArgument(executable)
For index = 1 To arguments.Count - 1
    commandLine = commandLine & " " & QuoteArgument(arguments(index))
Next

' wscript.exe is a GUI-subsystem host. Keep the nested console process hidden,
' while retaining its output and exit code for go test.
commandLine = shell.ExpandEnvironmentStrings("%ComSpec%") & _
    " /d /s /c " & Chr(34) & commandLine & _
    " > " & QuoteArgument(outputPath) & _
    " 2> " & QuoteArgument(errorPath) & Chr(34)
exitCode = shell.Run(commandLine, 0, True)

WriteFileToStream outputPath, WScript.StdOut
WriteFileToStream errorPath, WScript.StdErr

On Error Resume Next
fileSystem.DeleteFile outputPath, True
fileSystem.DeleteFile errorPath, True
On Error GoTo 0

WScript.Quit exitCode

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Sub WriteFileToStream(path, stream)
    Dim file, content

    On Error Resume Next
    Set file = fileSystem.OpenTextFile(path, 1, False, -2)
    If Err.Number = 0 Then
        content = file.ReadAll
        file.Close
        stream.Write content
    End If
    Err.Clear
    On Error GoTo 0
End Sub

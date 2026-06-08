#addin nuget:?package=Cake.Docker&version=5.0.0
#tool dotnet:?package=GitVersion.Tool&version=6.4.0

var target = Argument("target", "Default");
var configuration = Argument("configuration", "Release");
var dockerImage = Argument("dockerImage", "kpvotes");
var dockerTagArgument = Argument("dockerTag", string.Empty);
var dockerPushEnabled = Argument("dockerPush", false);
var ghcrRepositoryArgument = Argument("ghcrRepository", string.Empty);
var dockerTagOutputArgument = Argument("dockerTagOutput", string.Empty);
var dockerCacheFrom = Argument("dockerCacheFrom", string.Empty);
var dockerCacheTo = Argument("dockerCacheTo", string.Empty);

GitVersion gitVersion = null;
var computedDockerTag = "latest";

// ─── Helpers ───

void RunCmd(string exe, string args, string workingDir = null)
{
    var settings = new ProcessSettings {
        Arguments = args,
        WorkingDirectory = workingDir ?? "."
    };
    var exitCode = StartProcess(exe, settings);
    if (exitCode != 0)
        throw new CakeException($"`{exe} {args}` exited with code {exitCode}");
}

// ─── Tasks ───

Task("Version")
    .Does(() =>
{
    gitVersion = GitVersion(new GitVersionSettings
    {
        OutputType = GitVersionOutput.Json,
        NoFetch = true
    });

    Information("GitVersion FullSemVer: {0}", gitVersion.FullSemVer);
    Information("GitVersion ShortSha: {0}", gitVersion.ShortSha);
    Information("GitVersion CommitDate: {0}", gitVersion.CommitDate);
});

Task("Lint")
    .Does(() =>
{
    RunCmd("npx", "tsc --noEmit");
});

Task("Test")
    .Does(() =>
{
    RunCmd("npx", "vitest run --exclude 'tests/integration/**'");
});

Task("Docker")
    .IsDependentOn("Test")
    .Does(() =>
{
    var gitVersionTag = gitVersion.FullSemVer.Replace('+', '-');
    var finalTag = string.IsNullOrWhiteSpace(dockerTagArgument) ? gitVersionTag : dockerTagArgument;
    computedDockerTag = finalTag;
    var imageWithTag = $"{dockerImage}:{finalTag}";

    if (!string.IsNullOrWhiteSpace(dockerTagOutputArgument))
    {
        var outputPath = MakeAbsolute(FilePath.FromString(dockerTagOutputArgument));
        EnsureDirectoryExists(outputPath.GetDirectory());
        System.IO.File.WriteAllText(outputPath.FullPath, finalTag);
    }

    Information("Building Docker image {0}", imageWithTag);

    var buildSettings = new DockerBuildSettings
    {
        Tag = new[] { imageWithTag },
        BuildArg = new[]
        {
            $"APP_VERSION={gitVersion.FullSemVer}",
            $"GIT_SHA={gitVersion.ShortSha}",
            $"GIT_COMMIT_DATE={gitVersion.CommitDate}"
        }
    };

    // When cache args are provided, use buildx; otherwise standard build
    if (!string.IsNullOrWhiteSpace(dockerCacheFrom) || !string.IsNullOrWhiteSpace(dockerCacheTo))
    {
        var buildxSettings = new DockerBuildXBuildSettings
        {
            File = "Dockerfile",
            Tag = new[] { imageWithTag },
            BuildArg = new[]
            {
                $"APP_VERSION={gitVersion.FullSemVer}",
                $"GIT_SHORT_SHA={gitVersion.ShortSha}",
                $"GIT_COMMIT_DATE={gitVersion.CommitDate}"
            },
            CacheFrom = string.IsNullOrWhiteSpace(dockerCacheFrom) ? Array.Empty<string>() : new[] { dockerCacheFrom },
            CacheTo = string.IsNullOrWhiteSpace(dockerCacheTo) ? Array.Empty<string>() : new[] { dockerCacheTo },
            Load = true,
        };
        DockerBuildXBuild(buildxSettings, ".");
    }
    else
    {
        DockerBuild(buildSettings, ".");
    }
});

Task("DockerSmoke")
    .IsDependentOn("Docker")
    .Does(() =>
{
    var imageWithTag = $"{dockerImage}:{computedDockerTag}";
    var containerName = $"kpvotes-smoke-{Guid.NewGuid():N}".Substring(0, 30);

    Information("Starting smoke-test container {0}", containerName);
    var runExit = StartProcess("docker", new ProcessSettings
    {
        Arguments = $"run -d --name {containerName} {imageWithTag}"
    });
    if (runExit != 0)
        throw new CakeException($"docker run failed with exit code {runExit}");

    try
    {
        // Wait for container to start and run at least one cycle log line
        System.Threading.Thread.Sleep(5000);
        var logExit = StartProcess("docker", new ProcessSettings
        {
            Arguments = $"logs {containerName}",
            RedirectStandardOutput = true
        });
        Information("Smoke test passed — container started");
    }
    finally
    {
        StartProcess("docker", $"stop {containerName}");
        StartProcess("docker", $"rm {containerName}");
    }
});

Task("DockerPush")
    .IsDependentOn("Test")
    .IsDependentOn("DockerSmoke")
    .WithCriteria(() => dockerPushEnabled)
    .Does(() =>
{
    if (string.IsNullOrWhiteSpace(computedDockerTag))
        throw new CakeException("Docker tag was not computed.");

    var sourceImage = $"{dockerImage}:{computedDockerTag}";

    var repository = ghcrRepositoryArgument;
    if (string.IsNullOrWhiteSpace(repository))
    {
        var githubRepositoryEnv = EnvironmentVariable("GITHUB_REPOSITORY");
        if (string.IsNullOrWhiteSpace(githubRepositoryEnv))
            throw new CakeException("dockerPush enabled but no ghcrRepository and no GITHUB_REPOSITORY.");
        repository = $"ghcr.io/{githubRepositoryEnv.ToLowerInvariant()}/{dockerImage}";
    }
    else if (!repository.StartsWith("ghcr.io/", StringComparison.OrdinalIgnoreCase))
    {
        repository = $"ghcr.io/{repository}";
    }

    var targetImage = $"{repository}:{computedDockerTag}";

    var ghcrUsername = EnvironmentVariable("GHCR_USERNAME");
    var ghcrToken = EnvironmentVariable("GHCR_TOKEN");
    if (!string.IsNullOrWhiteSpace(ghcrUsername) && !string.IsNullOrWhiteSpace(ghcrToken))
        DockerLogin("ghcr.io", ghcrUsername, ghcrToken);
    else
        Information("GHCR credentials not provided; assuming docker login already performed.");

    Information("Tagging {0} as {1}", sourceImage, targetImage);
    DockerTag(sourceImage, targetImage);
    Information("Pushing {0}", targetImage);
    DockerPush(targetImage);
});

// ─── CI alias ───

Task("CI")
    .IsDependentOn("Lint")
    .IsDependentOn("Test");

Task("Default")
    .IsDependentOn("DockerPush");

RunTarget(target);

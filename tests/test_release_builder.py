import tempfile
import unittest
import zipfile
from pathlib import Path


from release_builder import (
    EXTENSION_PACKAGE_NAME,
    HOST_PACKAGE_NAME,
    build_release,
    extension_files,
    is_extension_excluded,
    package_extension,
    package_host_executable,
)


class ReleaseBuilderTests(unittest.TestCase):
    def test_extension_excludes_dev_old_and_unused_files(self):
        self.assertTrue(is_extension_excluded("studio-graph-src/src/main.jsx"))
        self.assertTrue(is_extension_excluded("New folder/background copy.js"))
        self.assertTrue(is_extension_excluded("test.html"))
        self.assertTrue(is_extension_excluded("todo"))
        self.assertTrue(is_extension_excluded("icons/icon1.jfif"))
        self.assertFalse(is_extension_excluded("manifest.json"))
        self.assertFalse(is_extension_excluded("studio-graph/index.html"))

    def test_extension_file_list_keeps_runtime_files_only(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            files = [
                "manifest.json",
                "background.js",
                "studio-graph/index.html",
                "studio-graph/assets/index.css",
                "studio-graph-src/src/main.jsx",
                "New folder/background copy.js",
                "test.html",
                "todo",
                "icons/icon2.png",
                "icons/icon3.jfif",
            ]
            for name in files:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name, encoding="utf-8")

            packaged = {str(path).replace("\\", "/") for path in extension_files(root)}

            self.assertIn("manifest.json", packaged)
            self.assertIn("studio-graph/assets/index.css", packaged)
            self.assertIn("icons/icon2.png", packaged)
            self.assertNotIn("studio-graph-src/src/main.jsx", packaged)
            self.assertNotIn("New folder/background copy.js", packaged)
            self.assertNotIn("icons/icon3.jfif", packaged)

    def test_packages_extension_zip_with_manifest_at_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "extension"
            root.mkdir()
            (root / "manifest.json").write_text("{}", encoding="utf-8")
            (root / "background.js").write_text("runtime", encoding="utf-8")
            (root / "studio-graph-src").mkdir()
            (root / "studio-graph-src" / "main.jsx").write_text("dev", encoding="utf-8")
            target = Path(temp) / "release" / EXTENSION_PACKAGE_NAME

            package_extension(root, target)

            with zipfile.ZipFile(target) as archive:
                names = set(archive.namelist())
            self.assertIn("manifest.json", names)
            self.assertIn("background.js", names)
            self.assertNotIn("studio-graph-src/main.jsx", names)

    def test_build_release_outputs_exactly_two_user_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            extension = root / "BRunner"
            host = root / "BRunner_Host" / "dist"
            output = root / "release"
            extension.mkdir()
            host.mkdir(parents=True)
            (extension / "manifest.json").write_text("{}", encoding="utf-8")
            (host / "BRunnerHost.exe").write_bytes(b"exe")

            extension_zip = package_extension(extension, output / EXTENSION_PACKAGE_NAME)
            host_exe = package_host_executable(host / "BRunnerHost.exe", output / HOST_PACKAGE_NAME)

            self.assertEqual(extension_zip.name, EXTENSION_PACKAGE_NAME)
            self.assertEqual(host_exe.name, HOST_PACKAGE_NAME)
            self.assertEqual(sorted(path.name for path in output.iterdir()), [
                EXTENSION_PACKAGE_NAME,
                HOST_PACKAGE_NAME,
            ])


if __name__ == "__main__":
    unittest.main()

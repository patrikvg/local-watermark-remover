import unittest
from geom import fit_long_side, pad_to_multiple


class GeomTest(unittest.TestCase):
    def test_pad_to_multiple_of_8(self):
        self.assertEqual(pad_to_multiple(720), 720)
        self.assertEqual(pad_to_multiple(721), 728)
        self.assertEqual(pad_to_multiple(1), 8)

    def test_fit_long_side_leaves_small_crops(self):
        self.assertEqual(fit_long_side(128, 88), (128, 88))

    def test_fit_long_side_caps_at_720(self):
        w, h = fit_long_side(1920, 800)
        self.assertEqual(max(w, h), 720)
        self.assertAlmostEqual(w / h, 1920 / 800, places=2)


if __name__ == "__main__":
    unittest.main()

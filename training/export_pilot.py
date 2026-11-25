"""Export the trained navigation controller for a marker already identified on the harbor chart."""
from pathlib import Path
import onnx
from onnx import checker, shape_inference, utils

def export_pilot(directory):
    model = shape_inference.infer_shapes(onnx.load(directory / 'navigation.onnx'))
    layer, = [node for node in model.graph.node if 'pilot.0.weight' in node.input]
    geometry = layer.input[0]
    pilot = utils.Extractor(model).extract_model([geometry], ['control'])
    pilot.graph.input[0].name = 'geometry'
    for node in pilot.graph.node:
        for i, name in enumerate(node.input):
            if name == geometry:
                node.input[i] = 'geometry'
    checker.check_model(pilot)
    onnx.save(pilot, directory / 'pilot.onnx')

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    export_pilot(parser.parse_args().directory)
